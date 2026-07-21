import io
import os
import shutil
import pandas as pd
from pypdf import PdfReader

# LangChain and Cohere imports
from langchain_community.document_loaders import DataFrameLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_cohere import CohereEmbeddings, ChatCohere
from langchain_community.vectorstores import FAISS
from langchain.chains import create_retrieval_chain
from langchain.chains.combine_documents import create_stuff_documents_chain
from langchain_core.prompts import ChatPromptTemplate

from app.database import get_connection

# Directory to save the local FAISS index
INDEX_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "faiss_index")

def extract_pdf_to_dataframe(pdf_bytes: bytes, source_id: str, source_name: str) -> pd.DataFrame:
    """
    Extracts text from a PDF in-memory and returns a Pandas DataFrame 
    where each row represents a page's content.
    """
    pdf_file = io.BytesIO(pdf_bytes)
    reader = PdfReader(pdf_file)
    
    records = []
    for i, page in enumerate(reader.pages):
        text = page.extract_text() or ""
        records.append({
            "text": text,
            "page": i + 1,
            "source_id": source_id,
            "source_name": source_name
        })
        
    return pd.DataFrame(records)

def get_embeddings():
    """Initializes the Cohere embedding model (optimized for multilingual text)."""
    # CohereEmbeddings will automatically look for the COHERE_API_KEY environment variable
    return CohereEmbeddings(model="embed-multilingual-v3.0")

def rebuild_index():
    """
    Rebuilds the FAISS vector index by fetching all documents from SQLite,
    processing them using Pandas, and index-generating via LangChain.
    """
    # 1. Fetch all documents from the SQLite database
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, filename, file_data FROM documents")
    rows = cursor.fetchall()
    conn.close()
    
    # If there are no documents, remove the local index folder
    if not rows:
        if os.path.exists(INDEX_DIR):
            shutil.rmtree(INDEX_DIR, ignore_errors=True)
        return None
        
    # 2. Extract text and create a combined Pandas DataFrame
    all_dfs = []
    for row in rows:
        df = extract_pdf_to_dataframe(row["file_data"], row["id"], row["filename"])
        all_dfs.append(df)
        
    master_df = pd.concat(all_dfs, ignore_index=True)
    
    # 3. Load DataFrame into LangChain Documents
    # LangChain's DataFrameLoader stores other columns (like page, source_name) as metadata!
    loader = DataFrameLoader(master_df, page_content_column="text")
    documents = loader.load()
    
    # 4. Split documents into small semantic chunks
    text_splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)
    chunks = text_splitter.split_documents(documents)
    
    # 5. Create FAISS vector store and save it locally
    embeddings = get_embeddings()
    vectorstore = FAISS.from_documents(chunks, embeddings)
    vectorstore.save_local(INDEX_DIR)
    
    return vectorstore

def load_vectorstore():
    """Loads the local FAISS vector store if it exists."""
    if not os.path.exists(INDEX_DIR):
        return None
    embeddings = get_embeddings()
    # allow_dangerous_deserialization is required because FAISS uses python pickling locally
    return FAISS.load_local(INDEX_DIR, embeddings, allow_dangerous_deserialization=True)

def ask_question(question: str) -> dict:
    """
    Performs vector similarity search on the FAISS index and uses
    Cohere's language model to answer the query with precise citations.
    """
    vectorstore = load_vectorstore()
    if not vectorstore:
        return {
            "answer": "No hay documentos cargados en el sistema. Por favor, sube un archivo PDF primero.",
            "sources": []
        }
        
    # Retrieve top 4 most similar chunks
    retriever = vectorstore.as_retriever(search_kwargs={"k": 4})
    
    # Initialize Cohere LLM (command-r-08-2024 is a valid alternative to deprecated command-r-plus)
    llm = ChatCohere(model="command-r-08-2024", temperature=0.1)
    
    # Formulate a structured prompt in Spanish
    system_prompt = (
        "Eres un asistente de inteligencia artificial experto en responder preguntas basadas únicamente en los documentos proporcionados.\n\n"
        "REGLAS IMPORTANTES:\n"
        "1. Responde de forma precisa, clara y en español utilizando únicamente la información de los fragmentos recuperados.\n"
        "2. Si los documentos no contienen la respuesta a la pregunta, responde exactamente con esta frase:\n"
        "   \"La información solicitada no se encuentra en los documentos proporcionados.\"\n"
        "   No intentes inventar nada, ni utilices conocimientos externos.\n"
        "3. Al final de tu respuesta o mientras respondes, cita el nombre del documento y la página correspondiente.\n\n"
        "Contexto:\n"
        "{context}"
    )
    
    prompt = ChatPromptTemplate.from_messages([
        ("system", system_prompt),
        ("human", "{input}"),
    ])
    
    # Setup LangChain chains
    question_answer_chain = create_stuff_documents_chain(llm, prompt)
    rag_chain = create_retrieval_chain(retriever, question_answer_chain)
    
    # Run the query
    response = rag_chain.invoke({"input": question})
    
    # Extract unique source references
    sources = []
    seen = set()
    for doc in response.get("context", []):
        meta = doc.metadata
        source_name = meta.get("source_name")
        page = meta.get("page")
        if source_name and page:
            source_key = (source_name, page)
            if source_key not in seen:
                seen.add(source_key)
                sources.append({
                    "document": source_name,
                    "page": int(page)
                })
                
    return {
        "answer": response["answer"],
        "sources": sources
    }

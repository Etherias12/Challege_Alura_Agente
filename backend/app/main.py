import uuid
from fastapi import FastAPI, UploadFile, File, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel
import io
from pypdf import PdfReader

# Import database and RAG functions
from app.database import init_db, save_document, list_documents, get_document, delete_document
from app.rag import rebuild_index, ask_question

app = FastAPI(
    title="RAG PDF Backend with Cohere & LangChain",
    description="A FastAPI backend that extracts text from PDFs, indexes them using LangChain/Cohere, and processes RAG QA queries.",
    version="1.0.0"
)

# Enable CORS (Cross-Origin Resource Sharing)
# This allows our React frontend (running in Figma or another local port) to communicate with this API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class QuestionRequest(BaseModel):
    question: str

@app.on_event("startup")
async def startup_event():
    """Ran when the FastAPI server starts. Configures SQLite and builds indices."""
    init_db()
    # Rebuild the FAISS index on startup if there are existing documents in the database
    # This ensures that even if the container or server restarts, our vector index is populated.
    try:
        rebuild_index()
    except Exception as e:
        print(f"Warning: Could not rebuild vector index on startup. Is COHERE_API_KEY set? Error: {e}")

@app.get("/")
async def root():
    return {"message": "RAG PDF Backend is running. Please use /api endpoints."}

@app.post("/api/upload", status_code=status.HTTP_201_CREATED)
async def upload_pdf(file: UploadFile = File(...)):
    """
    Uploads a PDF file, parses page count, stores it in SQLite (as BLOB),
    rebuilds the FAISS vector index, and returns the saved metadata.
    """
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Solo se admiten archivos en formato PDF (.pdf)."
        )
        
    try:
        # Read the file bytes
        file_bytes = await file.read()
        file_size = len(file_bytes)
        
        # Determine page count using PyPDF
        try:
            pdf_file = io.BytesIO(file_bytes)
            reader = PdfReader(pdf_file)
            page_count = len(reader.pages)
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"No se pudo leer el archivo PDF. Puede estar dañado. Error: {str(e)}"
            )
            
        # Generate a unique document ID
        doc_id = str(uuid.uuid4())
        
        # Save to SQLite database (storing binary data)
        save_document(
            doc_id=doc_id,
            filename=file.filename,
            file_bytes=file_bytes,
            page_count=page_count,
            file_size=file_size
        )
        
        # Trigger an asynchronous/synchronous rebuild of the vector search database
        rebuild_index()
        
        return {
            "success": True,
            "document": {
                "id": doc_id,
                "filename": file.filename,
                "pages": page_count,
                "size": file_size
            }
        }
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Ocurrió un error al procesar y almacenar el archivo. Error: {str(e)}"
        )

@app.get("/api/documents")
async def get_all_documents():
    """Lists all uploaded documents with their metadata (size, pages, dates)."""
    try:
        docs = list_documents()
        return {"success": True, "documents": docs}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error al listar documentos de la base de datos: {str(e)}"
        )

@app.get("/api/documents/{doc_id}")
async def download_document(doc_id: str):
    """Retrieves and streams a document PDF binary from the SQLite database."""
    doc = get_document(doc_id)
    if not doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Documento no encontrado."
        )
        
    # Return the PDF file binary stream
    return StreamingResponse(
        io.BytesIO(doc["file_data"]),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"inline; filename={doc['filename']}"
        }
    )

@app.delete("/api/documents/{doc_id}")
async def delete_pdf(doc_id: str):
    """Deletes a PDF file from SQLite and rebuilds the vector index."""
    doc = get_document(doc_id)
    if not doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Documento no encontrado."
        )
        
    try:
        # Delete from DB
        delete_document(doc_id)
        
        # Rebuild vector store index to exclude deleted text chunks
        rebuild_index()
        
        return {"success": True, "message": f"Documento '{doc['filename']}' eliminado correctamente."}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error al eliminar el documento: {str(e)}"
        )

@app.post("/api/ask")
async def ask_pdf_question(request: QuestionRequest):
    """
    Processes a user's question, uses RAG vector search, and returns an answer
    generated by Cohere's language model citing precise documents and pages.
    """
    if not request.question.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La pregunta no puede estar vacía."
        )
        
    try:
        response_data = ask_question(request.question)
        return {
            "success": True,
            "answer": response_data["answer"],
            "sources": response_data["sources"]
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error al generar la respuesta mediante el modelo de lenguaje: {str(e)}"
        )

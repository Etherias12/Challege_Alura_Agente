import os
from dotenv import load_dotenv
import pandas as pd

# Load env variables
load_dotenv()

def generate_valid_pdf_bytes(text_content: str) -> bytes:
    """Generates a valid 1-page PDF with correct cross-reference offsets and Helvetica font mapping."""
    header = b"%PDF-1.4\n"
    objects = [
        # Obj 1: Catalog
        b"<< /Type /Catalog /Pages 2 0 R >>",
        # Obj 2: Pages
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        # Obj 3: Page
        b"<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 5 0 R >> >> /MediaBox [0 0 595 842] /Contents 4 0 R >>",
        # Obj 4: Content Stream
        b"", # Placeholder for stream content
        # Obj 5: Font definition
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
    ]
    
    # Format and place stream content in Obj 4
    stream_content = f"BT\n/F1 12 Tf\n72 712 Td\n({text_content}) Tj\nET".encode("ascii")
    objects[3] = f"<< /Length {len(stream_content)} >>\nstream\n".encode("ascii") + stream_content + b"\nendstream"
    
    body = b""
    offsets = []
    for i, obj in enumerate(objects):
        offsets.append(len(header) + len(body))
        body += f"{i+1} 0 obj\n".encode("ascii") + obj + b"\nendobj\n"
        
    startxref = len(header) + len(body)
    
    xref = f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode("ascii")
    for offset in offsets:
        xref += f"{offset:010d} 00000 n \n".encode("ascii")
        
    trailer = (
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n".encode("ascii") +
        f"startxref\n{startxref}\n".encode("ascii") +
        b"%%EOF"
    )
    return header + body + xref + trailer

MINIMAL_PDF_BYTES = generate_valid_pdf_bytes(
    "Este es un documento PDF de prueba para verificar Cohere y Pandas. La capital de Francia es Paris y la de Espana es Madrid."
)

def run_tests():
    print("=== INICIANDO PRUEBAS DE INTEGRACIÓN DEL BACKEND ===")
    
    # 1. Initialize Database
    print("\n1. Inicializando base de datos SQLite...")
    from app.database import init_db, save_document, list_documents, get_document, delete_document
    init_db()
    print("   [OK] Base de datos inicializada correctamente.")
    
    # 2. Save a PDF Document
    print("\n2. Guardando archivo PDF de prueba en base de datos como BLOB...")
    test_id = "test-doc-789"
    test_filename = "prueba_capitales.pdf"
    file_size = len(MINIMAL_PDF_BYTES)
    page_count = 1
    
    save_document(
        doc_id=test_id,
        filename=test_filename,
        file_bytes=MINIMAL_PDF_BYTES,
        page_count=page_count,
        file_size=file_size
    )
    print("   [OK] Archivo guardado con éxito.")
    
    # 3. List Documents
    print("\n3. Listando documentos en base de datos...")
    docs = list_documents()
    print(f"   Documentos encontrados: {len(docs)}")
    assert len(docs) >= 1, "Error: El documento guardado no se listó."
    test_doc = next(d for d in docs if d["id"] == test_id)
    print(f"   [OK] Encontrado: '{test_doc['filename']}' ({test_doc['file_size']} bytes, {test_doc['page_count']} páginas).")
    
    # 4. Fetch Document Binary
    print("\n4. Recuperando datos del BLOB para verificar integridad...")
    doc_data = get_document(test_id)
    assert doc_data is not None, "Error: No se pudo recuperar el documento."
    assert doc_data["file_data"] == MINIMAL_PDF_BYTES, "Error: El archivo recuperado no coincide con el original."
    print("   [OK] Los datos binarios recuperados coinciden exactamente con el PDF original.")
    
    # 5. Extract to Pandas DataFrame
    print("\n5. Extrayendo texto a Pandas DataFrame...")
    from app.rag import extract_pdf_to_dataframe
    df = extract_pdf_to_dataframe(doc_data["file_data"], test_id, test_filename)
    print(f"   Columnas del DataFrame: {list(df.columns)}")
    print(f"   Filas del DataFrame: {len(df)}")
    assert isinstance(df, pd.DataFrame), "Error: No se retornó un DataFrame de Pandas."
    assert len(df) == 1, "Error: El número de páginas no coincide."
    extracted_text = df.iloc[0]["text"]
    print(f"   Texto extraído: '{extracted_text}'")
    assert "capital de Francia es Paris" in extracted_text, "Error: El texto extraído no es correcto."
    print("   [OK] Extracción e indexación con Pandas completada con éxito.")
    
    # 6. Rebuild FAISS Vector Store Index
    print("\n6. Reconstruyendo índice vectorial FAISS...")
    from app.rag import rebuild_index
    
    api_key = os.getenv("COHERE_API_KEY", "")
    is_api_key_valid = api_key and api_key != "your_cohere_api_key_here"
    
    if not is_api_key_valid:
        print("   [AVISO] No se ha configurado la API Key de Cohere válida. Saltando creación de índice y QA.")
    else:
        vectorstore = rebuild_index()
        assert vectorstore is not None, "Error: No se creó el almacén de vectores."
        print("   [OK] Índice vectorial FAISS reconstruido y guardado localmente.")
        
        # 7. Query RAG Model
        print("\n7. Realizando pregunta de prueba (RAG) con Cohere y LangChain...")
        from app.rag import ask_question
        question = "¿Cuál es la capital de Francia y de España según el documento?"
        print(f"   Pregunta: '{question}'")
        response = ask_question(question)
        print(f"   Respuesta: '{response['answer']}'")
        print(f"   Fuentes citadas: {response['sources']}")
        assert len(response["sources"]) > 0, "Error: No se citaron fuentes."
        print("   [OK] RAG QA completado correctamente con citación de fuentes.")
        
    # 8. Cleanup test document
    print("\n8. Eliminando documento de prueba...")
    delete_document(test_id)
    if is_api_key_valid:
        rebuild_index()
    docs_after = list_documents()
    assert not any(d["id"] == test_id for d in docs_after), "Error: El documento no fue eliminado."
    print("   [OK] Documento de prueba eliminado y base de datos limpia.")
    
    print("\n=== ¡TODAS LAS PRUEBAS SE COMPLETARON CON ÉXITO! ===")

if __name__ == "__main__":
    run_tests()

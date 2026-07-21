import sqlite3
import os
from datetime import datetime

# Define the DB path in the parent directory of this file (inside the backend folder)
DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "documents.db")

def get_connection():
    """Returns a SQLite connection with rows configured to act like dictionaries."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    """Initializes the database schema if it doesn't already exist."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS documents (
            id TEXT PRIMARY KEY,
            filename TEXT NOT NULL,
            file_data BLOB NOT NULL,
            upload_time TEXT NOT NULL,
            page_count INTEGER,
            file_size INTEGER
        )
    """)
    conn.commit()
    conn.close()

def save_document(doc_id: str, filename: str, file_bytes: bytes, page_count: int, file_size: int):
    """Saves a document PDF file (as a binary BLOB) and its metadata in the database."""
    conn = get_connection()
    cursor = conn.cursor()
    upload_time = datetime.utcnow().isoformat()
    cursor.execute("""
        INSERT INTO documents (id, filename, file_data, upload_time, page_count, file_size)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (doc_id, filename, file_bytes, upload_time, page_count, file_size))
    conn.commit()
    conn.close()

def list_documents():
    """Lists all documents stored in the database, excluding the heavy binary BLOB file data."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, filename, upload_time, page_count, file_size 
        FROM documents 
        ORDER BY upload_time DESC
    """)
    rows = cursor.fetchall()
    conn.close()
    return [dict(row) for row in rows]

def get_document(doc_id: str):
    """Retrieves a single document, including its binary file BLOB data, by ID."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, filename, file_data, upload_time, page_count, file_size 
        FROM documents 
        WHERE id = ?
    """, (doc_id,))
    row = cursor.fetchone()
    conn.close()
    if row:
        return dict(row)
    return None

def delete_document(doc_id: str):
    """Deletes a document from the database by ID."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM documents WHERE id = ?", (doc_id,))
    conn.commit()
    conn.close()

# Challege_Alura_Agente
 DocChat: RAG PDF Assistant

  Una aplicación de chat inteligente que permite subir documentos PDF y hacer preguntas sobre ellos utilizando inteligencia artificial (Cohere) y una arquitectura RAG (Retrieval-Augmented Generation).

  🚀 Características
   - Subida de archivos PDF.
   - Procesamiento de documentos y extracción de texto mediante Pandas y PyPDF.
   - Búsqueda vectorial local con FAISS.
   - Respuestas generadas por IA (Cohere) con citación de fuentes.
   - Frontend moderno construido con React y Vite.

  📋 Requisitos Previos
   - Node.js (v18 o superior recomendado)
   - Python (v3.10 o superior)
   - pip (gestor de paquetes de Python)

  🛠 Instalación y Configuración

  1. Clonar el repositorio

   1 git clone <URL_DE_TU_REPOSITORIO>
   2 cd <NOMBRE_DE_TU_PROYECTO>

  2. Configurar el Backend

   1 cd backend
   2 # Crear entorno virtual
   3 python3 -m venv .venv
   4 # Activar entorno
   5 source .venv/bin/activate  # En Windows usa: .venv\Scripts\activate
   6 # Instalar dependencias
   7 pip install -r requirements.txt

  Configuración de variables de entorno
  Crea un archivo .env en la carpeta backend/ basado en el ejemplo:

   1 cp .env.example .env
   2 # Edita .env e inserta tu COHERE_API_KEY

  3. Configurar el Frontend
   1 # Regresa a la raíz
   2 cd ..
   3 # Instalar dependencias
   4 npm install

  ▶️ Ejecución del Proyecto

  Necesitarás dos terminales abiertas:

  Terminal 1 (Backend):

   1 cd backend
   2 source .venv/bin/activate
   3 python run.py

  Terminal 2 (Frontend):
   1 # Desde la raíz
   2 npm run dev

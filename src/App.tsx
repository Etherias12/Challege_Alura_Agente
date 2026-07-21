import { useState, useRef, useEffect, useCallback, type DragEvent, type ChangeEvent } from 'react'

interface UploadedDoc {
  id: string
  name: string
  size: number
  pages: number
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  loading?: boolean
}

async function uploadPDFToBackend(file: File): Promise<{ id: string; filename: string; pages: number; size: number }> {
  console.log('Iniciando subida de archivo:', file.name)
  const formData = new FormData()
  formData.append('file', file)
  try {
    const response = await fetch('http://localhost:8000/api/upload', {
      method: 'POST',
      body: formData,
    })
    console.log('Respuesta del servidor recibida, status:', response.status)
    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      console.error('Error en respuesta del servidor:', err)
      throw new Error(err.detail || 'Error al subir el archivo')
    }
    const data = await response.json()
    console.log('Datos del documento parseados:', data)
    return data.document
  } catch (error) {
    console.error('Error en fetch de subida:', error)
    throw error
  }
}

async function askRAGBackend(question: string): Promise<{ answer: string; sources: { document: string; page: number }[] }> {
  const response = await fetch('http://localhost:8000/api/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }),
  })
  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.detail || 'Error en la consulta')
  }
  return response.json()
}

async function deletePDFFromBackend(id: string): Promise<void> {
  const response = await fetch(`http://localhost:8000/api/documents/${id}`, { method: 'DELETE' })
  if (!response.ok) throw new Error('Error al eliminar')
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function DocIcon({ pages }: { pages: number }) {
  return (
    <div
      style={{
        width: 36,
        height: 44,
        background: 'var(--accent-dim)',
        border: '1px solid rgba(91,106,244,0.3)',
        borderRadius: 5,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        position: 'relative',
      }}
    >
      <span style={{ color: 'var(--accent)', fontSize: 9, fontWeight: 700, fontFamily: 'JetBrains Mono' }}>
        PDF
      </span>
      <span style={{ color: 'var(--text-muted)', fontSize: 8, marginTop: 1 }}>{pages}p</span>
    </div>
  )
}

function TypingDots() {
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', padding: '2px 0' }}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: 'var(--text-muted)',
            display: 'inline-block',
            animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
          }}
        />
      ))}
      <style>{`@keyframes bounce { 0%,80%,100%{transform:translateY(0)} 40%{transform:translateY(-6px)} }`}</style>
    </span>
  )
}

export default function App() {
  const [docs, setDocs] = useState<UploadedDoc[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [dragging, setDragging] = useState(false)

  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [chatError, setChatError] = useState('')

  const chatEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Cargar documentos existentes al iniciar la app
  useEffect(() => {
    async function fetchDocuments() {
      try {
        const response = await fetch('http://localhost:8000/api/documents')
        const data = await response.json()
        if (data.success) {
          setDocs(data.documents.map((d: any) => ({
            id: d.id,
            name: d.filename,
            size: d.file_size,
            pages: d.page_count
          })))
        }
      } catch (e) {
        console.error('Error al cargar documentos iniciales:', e)
      }
    }
    fetchDocuments()
  }, [])

  const processFiles = useCallback(async (files: File[]) => {
    console.log('processFiles llamada con archivos:', files)
    const pdfs = files.filter((f) => f.type === 'application/pdf' || f.name.endsWith('.pdf'))
    console.log('PDFs filtrados:', pdfs)
    if (!pdfs.length) {
      setUploadError('Solo se aceptan archivos PDF.')
      return
    }
    setUploading(true)
    setUploadError('')
    for (const file of pdfs) {
      try {
        const doc = await uploadPDFToBackend(file)
        console.log('Documento recibido del backend:', doc)
        setDocs((prev) => [
          ...prev,
          {
            id: doc.id,
            name: doc.filename,
            size: doc.size,
            pages: doc.pages,
          },
        ])
      } catch (e: any) {
        setUploadError(`No se pudo subir "${file.name}": ${e.message}`)
      }
    }
    setUploading(false)
  }, [])

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    console.log('handleFileChange evento disparado')
    if (e.target.files) {
      console.log('Archivos detectados en input:', e.target.files)
      processFiles(Array.from(e.target.files))
    }
    e.target.value = ''
  }

  const handleDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    processFiles(Array.from(e.dataTransfer.files))
  }

  const removeDoc = async (id: string) => {
    try {
      await deletePDFFromBackend(id)
      setDocs((prev) => prev.filter((d) => d.id !== id))
    } catch {
      setUploadError('Error al eliminar el documento.')
    }
  }

  const handleSend = async () => {
    const q = input.trim()
    if (!q || sending) return
    if (!docs.length) {
      setChatError('Sube al menos un documento antes de hacer preguntas.')
      return
    }

    setChatError('')
    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content: q }
    const loadingMsg: Message = { id: crypto.randomUUID(), role: 'assistant', content: '', loading: true }
    setMessages((prev) => [...prev, userMsg, loadingMsg])
    setInput('')
    setSending(true)

    try {
      const response = await askRAGBackend(q)
      const formattedAnswer = `${response.answer}\n\n${response.sources.length > 0 ? 'Fuentes:\n' + response.sources.map(s => `- ${s.document} (pág. ${s.page})`).join('\n') : ''}`
      setMessages((prev) =>
        prev.map((m) => (m.loading ? { ...m, content: formattedAnswer, loading: false } : m))
      )
    } catch (err: any) {
      setMessages((prev) =>
        prev.map((m) =>
          m.loading ? { ...m, content: `Error: ${err.message}`, loading: false } : m
        )
      )
    }
    setSending(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const adjustTextarea = () => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg)' }}>
      {/* Header */}
      <header
        style={{
          height: 52,
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          padding: '0 24px',
          gap: 12,
          flexShrink: 0,
          background: 'var(--surface)',
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 7,
            background: 'var(--accent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
        </div>
        <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--text)', letterSpacing: '-0.01em' }}>
          DocChat
        </span>
        <span
          style={{
            marginLeft: 2,
            fontSize: 11,
            color: 'var(--text-muted)',
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            borderRadius: 4,
            padding: '2px 7px',
            fontFamily: 'JetBrains Mono',
          }}
        >
          beta
        </span>

        <div style={{ flex: 1 }} />
      </header>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Sidebar */}
        <aside
          style={{
            width: 280,
            borderRight: '1px solid var(--border)',
            background: 'var(--surface)',
            display: 'flex',
            flexDirection: 'column',
            flexShrink: 0,
            overflow: 'hidden',
          }}
        >
          {/* Upload zone */}
          <div style={{ padding: '16px 16px 12px' }}>
            <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 10, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              Documentos
            </p>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: `1.5px dashed ${dragging ? 'var(--accent)' : 'var(--border-strong)'}`,
                borderRadius: 10,
                padding: '20px 16px',
                textAlign: 'center',
                cursor: 'pointer',
                transition: 'all 0.15s',
                background: dragging ? 'var(--accent-dim)' : 'transparent',
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 9,
                  background: 'var(--accent-dim)',
                  border: '1px solid rgba(91,106,244,0.25)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 10px',
                }}
              >
                {uploading ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" style={{ animation: 'spin 1s linear infinite' }}>
                    <path d="M21 12a9 9 0 11-6.219-8.56" />
                    <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                )}
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-dim)', margin: 0, lineHeight: 1.5 }}>
                {uploading ? 'Procesando...' : 'Arrastra PDFs aquí o haz clic'}
              </p>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '4px 0 0' }}>Solo archivos .pdf</p>
            </div>
            <input ref={fileInputRef} type="file" accept=".pdf" multiple onChange={handleFileChange} style={{ display: 'none' }} />
            {uploadError && (
              <p style={{ fontSize: 11, color: 'var(--danger)', marginTop: 8, margin: '8px 0 0' }}>{uploadError}</p>
            )}
          </div>

          {/* Doc list */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '0 12px 12px' }}>
            {docs.length === 0 ? (
              <div style={{ padding: '12px 4px', textAlign: 'center' }}>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                  Ningún documento cargado.<br />Sube un PDF para comenzar.
                </p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {docs.map((doc) => (
                  <div
                    key={doc.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '10px 12px',
                      background: 'var(--surface-2)',
                      border: '1px solid var(--border)',
                      borderRadius: 9,
                    }}
                  >
                    <DocIcon pages={doc.pages} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{
                        fontSize: 12,
                        fontWeight: 500,
                        color: 'var(--text)',
                        margin: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {doc.name}
                      </p>
                      <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '2px 0 0' }}>
                        {formatSize(doc.size)} · {doc.pages} págs.
                      </p>
                    </div>
                    <button
                      onClick={() => removeDoc(doc.id)}
                      title="Eliminar documento"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        padding: 4,
                        cursor: 'pointer',
                        color: 'var(--text-muted)',
                        display: 'flex',
                        alignItems: 'center',
                        borderRadius: 4,
                        flexShrink: 0,
                      }}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Docs summary */}
          {docs.length > 0 && (
            <div style={{
              borderTop: '1px solid var(--border)',
              padding: '10px 16px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {docs.length} documento{docs.length > 1 ? 's' : ''} cargado{docs.length > 1 ? 's' : ''}
              </span>
              <button
                onClick={() => setDocs([])}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  borderRadius: 5,
                  padding: '3px 8px',
                  fontSize: 11,
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                }}
              >
                Limpiar todo
              </button>
            </div>
          )}
        </aside>

        {/* Chat area */}
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg)' }}>
          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '24px 0' }}>
            {messages.length === 0 ? (
              <div style={{
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 16,
                padding: '0 40px',
                textAlign: 'center',
              }}>
                <div style={{
                  width: 56,
                  height: 56,
                  borderRadius: 14,
                  background: 'var(--accent-dim)',
                  border: '1px solid rgba(91,106,244,0.25)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.8">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                </div>
                <div>
                  <p style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', margin: 0 }}>
                    Haz preguntas sobre tus documentos
                  </p>
                  <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6, maxWidth: 360, lineHeight: 1.6 }}>
                    Sube uno o más PDFs y el modelo responderá basándose exclusivamente en su contenido.
                  </p>
                </div>
              </div>
            ) : (
              <div style={{ maxWidth: 760, margin: '0 auto', padding: '0 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    style={{
                      display: 'flex',
                      gap: 14,
                      flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
                      alignItems: 'flex-start',
                    }}
                  >
                    {/* Avatar */}
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 8,
                        flexShrink: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 12,
                        fontWeight: 700,
                        background: msg.role === 'user' ? 'var(--accent)' : 'var(--surface-2)',
                        border: msg.role === 'assistant' ? '1px solid var(--border-strong)' : 'none',
                        color: msg.role === 'user' ? '#fff' : 'var(--text-dim)',
                      }}
                    >
                      {msg.role === 'user' ? 'U' : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
                          <line x1="12" y1="17" x2="12.01" y2="17"/>
                        </svg>
                      )}
                    </div>

                    {/* Bubble */}
                    <div
                      style={{
                        maxWidth: '75%',
                        background: msg.role === 'user' ? 'var(--accent)' : 'var(--surface)',
                        border: msg.role === 'assistant' ? '1px solid var(--border)' : 'none',
                        borderRadius: msg.role === 'user' ? '12px 4px 12px 12px' : '4px 12px 12px 12px',
                        padding: '12px 16px',
                        color: msg.role === 'user' ? '#fff' : 'var(--text)',
                        fontSize: 14,
                        lineHeight: 1.65,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                      }}
                    >
                      {msg.loading ? <TypingDots /> : msg.content}
                    </div>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>
            )}
          </div>

          {/* Input bar */}
          <div style={{ borderTop: '1px solid var(--border)', padding: '14px 24px 16px', background: 'var(--surface)', flexShrink: 0 }}>
            {chatError && (
              <p style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 8, margin: '0 0 8px' }}>{chatError}</p>
            )}
            <div
              style={{
                maxWidth: 760,
                margin: '0 auto',
                display: 'flex',
                alignItems: 'flex-end',
                gap: 10,
                background: 'var(--surface-2)',
                border: '1px solid var(--border-strong)',
                borderRadius: 12,
                padding: '10px 12px',
              }}
            >
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => { setInput(e.target.value); adjustTextarea() }}
                onKeyDown={handleKeyDown}
                placeholder={docs.length === 0 ? 'Sube un documento para comenzar...' : 'Escribe tu pregunta sobre los documentos...'}
                disabled={docs.length === 0 || sending}
                rows={1}
                style={{
                  flex: 1,
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  resize: 'none',
                  color: 'var(--text)',
                  fontSize: 14,
                  lineHeight: 1.5,
                  fontFamily: 'Plus Jakarta Sans',
                  maxHeight: 160,
                  overflowY: 'auto',
                  padding: 0,
                  opacity: (docs.length === 0) ? 0.5 : 1,
                }}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || sending || docs.length === 0}
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 8,
                  background: input.trim() && !sending && docs.length > 0 ? 'var(--accent)' : 'var(--surface)',
                  border: '1px solid var(--border-strong)',
                  cursor: input.trim() && !sending && docs.length > 0 ? 'pointer' : 'not-allowed',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.15s',
                  flexShrink: 0,
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', marginTop: 8, margin: '8px 0 0' }}>
              Enter para enviar · Shift+Enter para nueva línea
            </p>
          </div>
        </main>
      </div>
    </div>
  )
}

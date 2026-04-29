'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import type { Client, Document } from '@/lib/supabase'

type InternalNote = {
  id: string
  client_id: string
  author: string
  content: string
  created_at: string
}

type Profile = {
  id: string
  full_name: string
  role: 'admin' | 'member'
}

const TEAM_MEMBERS = ['Unassigned', 'Admin', 'Team Member 1', 'Team Member 2']

export default function AdminPage() {
  const router = useRouter()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [clients, setClients] = useState<Client[]>([])
  const [documents, setDocuments] = useState<Document[]>([])
  const [notes, setNotes] = useState<InternalNote[]>([])
  const [selected, setSelected] = useState<Client | null>(null)
  const [loading, setLoading] = useState(true)
  const [mounted, setMounted] = useState(false)
  const [darkMode, setDarkMode] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [newNote, setNewNote] = useState('')
  const [showArchive, setShowArchive] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState<Client | null>(null)
  const [notification, setNotification] = useState<string | null>(null)
  const [confirmDeleteClient, setConfirmDeleteClient] = useState<Client | null>(null)
  const [confirmDeleteDoc, setConfirmDeleteDoc] = useState<Document | null>(null)

  useEffect(() => {
    const saved = localStorage.getItem('darkMode')
    if (saved !== null) setDarkMode(saved === 'true')
    setMounted(true)
  }, [])

  useEffect(() => { init() }, [])

  useEffect(() => {
    if (!profile) return
    const channel = supabase
      .channel('documents-changes')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'documents' },
        async (payload) => {
          const { data: client } = await supabase
            .from('clients')
            .select('first_name, last_name')
            .eq('id', payload.new.client_id)
            .single()

          if (client) {
            setNotification(`📄 ${client.first_name} ${client.last_name} just uploaded a new file`)
            setTimeout(() => setNotification(null), 5000)
            await fetchClients(profile)
          }
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [profile])

  const init = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: profileData } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single()
    if (profileData) {
      setProfile(profileData)
      await fetchClients(profileData)
    }
    setLoading(false)
  }

  const fetchClients = async (p: Profile) => {
    let query = supabase.from('clients').select('*').order('created_at', { ascending: false })
    if (p.role === 'member') query = query.eq('assigned_to', p.full_name)
    const { data } = await query
    if (data) setClients(data)
  }

  const fetchDocuments = async (clientId: string) => {
    const { data } = await supabase.from('documents').select('*').eq('client_id', clientId).order('uploaded_at', { ascending: false })
    if (data) setDocuments(data)
  }

  const fetchNotes = async (clientId: string) => {
    const { data } = await supabase.from('internal_notes').select('*').eq('client_id', clientId).order('created_at', { ascending: true })
    if (data) setNotes(data)
  }

  const selectClient = (client: Client) => {
    setSelected(client)
    fetchDocuments(client.id)
    fetchNotes(client.id)
  }

  const updateStatus = async (status: string) => {
    if (!selected) return
    await supabase.from('clients').update({ status }).eq('id', selected.id)
    const updated = { ...selected, status: status as Client['status'] }
    setSelected(updated)
    setClients(clients.map(c => c.id === selected.id ? updated : c))
  }

  const updateAssignee = async (assigned_to: string) => {
    if (!selected) return
    await supabase.from('clients').update({ assigned_to }).eq('id', selected.id)
    const updated = { ...selected, assigned_to }
    setSelected(updated)
    setClients(clients.map(c => c.id === selected.id ? updated : c))
  }

  const addNote = async () => {
    if (!newNote.trim() || !selected || !profile) return
    const { data } = await supabase
      .from('internal_notes')
      .insert([{ client_id: selected.id, author: profile.full_name, content: newNote.trim() }])
      .select()
      .single()
    if (data) setNotes([...notes, data])
    setNewNote('')
  }

  const handleArchiveClick = (e: React.MouseEvent, client: Client) => {
    e.stopPropagation()
    if (client.status === 'complete') {
      archiveClient(client)
    } else {
      setConfirmArchive(client)
    }
  }

  const archiveClient = async (client: Client) => {
    await supabase.from('clients').update({ archived: true }).eq('id', client.id)
    setClients(clients.map(c => c.id === client.id ? { ...c, archived: true } : c))
    if (selected?.id === client.id) setSelected(null)
    setConfirmArchive(null)
  }

  const unarchiveClient = async (client: Client) => {
    await supabase.from('clients').update({ archived: false }).eq('id', client.id)
    setClients(clients.map(c => c.id === client.id ? { ...c, archived: false } : c))
  }

  const deleteClient = async (client: Client) => {
    await supabase.storage.from('documents').list(client.id).then(async ({ data }) => {
      if (data && data.length > 0) {
        const paths = data.map(f => `${client.id}/${f.name}`)
        await supabase.storage.from('documents').remove(paths)
      }
    })
    await supabase.from('clients').delete().eq('id', client.id)
    setClients(clients.filter(c => c.id !== client.id))
    if (selected?.id === client.id) setSelected(null)
    setConfirmDeleteClient(null)
  }

  const deleteDocument = async (doc: Document) => {
    await supabase.storage.from('documents').remove([doc.file_path])
    await supabase.from('documents').delete().eq('id', doc.id)
    setDocuments(documents.filter(d => d.id !== doc.id))
    setConfirmDeleteDoc(null)
  }

  const getDownloadUrl = async (path: string) => {
    const { data } = await supabase.storage.from('documents').createSignedUrl(path, 60)
    if (data) window.open(data.signedUrl, '_blank')
  }

  const generateClientLink = () => {
    const token = Math.random().toString(36).substring(2, 10)
    const url = `${window.location.origin}/client/${token}`
    navigator.clipboard.writeText(url)
    alert(`Link copied!\n\n${url}`)
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    window.location.href = '/admin/login'
  }

  const activeClients = clients.filter(c => !c.archived)
  const archivedClients = clients.filter(c => c.archived)

  const filteredClients = (showArchive ? archivedClients : activeClients).filter(c => {
    const matchesSearch = `${c.first_name} ${c.last_name}`.toLowerCase().includes(search.toLowerCase())
    const matchesFilter = filter === 'all' || c.status === filter
    return matchesSearch && matchesFilter
  })

  const statusColor = (status: string) => {
    if (status === 'complete') return 'bg-green-100 text-green-700'
    if (status === 'in_progress') return 'bg-yellow-100 text-yellow-700'
    return 'bg-red-100 text-red-700'
  }

  const statusDot = (status: string) => {
    if (status === 'complete') return 'bg-green-500'
    if (status === 'in_progress') return 'bg-yellow-500'
    return 'bg-red-500'
  }

  const statusLabel = (status: string) => {
    if (status === 'complete') return 'Complete'
    if (status === 'in_progress') return 'In progress'
    return 'Pending'
  }

  const initials = (c: Client) => `${c.first_name[0]}${c.last_name[0]}`.toUpperCase()
  const avatarColor = (i: number) => {
    const colors = ['bg-blue-100 text-blue-700', 'bg-teal-100 text-teal-700', 'bg-amber-100 text-amber-700', 'bg-rose-100 text-rose-700', 'bg-purple-100 text-purple-700']
    return colors[i % colors.length]
  }

  const bg = darkMode ? 'bg-gray-900' : 'bg-gray-50'
  const sidebar = darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
  const panel = darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
  const text = darkMode ? 'text-gray-100' : 'text-gray-800'
  const subtext = darkMode ? 'text-gray-400' : 'text-gray-500'
  const inputClass = darkMode ? 'bg-gray-700 border-gray-600 text-gray-100 placeholder-gray-400' : 'bg-white border-gray-200 text-gray-800 placeholder-gray-400'
  const divider = darkMode ? 'border-gray-700' : 'border-gray-100'
  const hover = darkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-50'
  const selectedBg = darkMode ? 'bg-gray-700' : 'bg-blue-50'

  if (!mounted || loading) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-sm text-gray-500">Loading...</p>
      </main>
    )
  }

  return (
    <main className={`min-h-screen ${bg} transition-colors duration-300`}>

      {/* Notificación en tiempo real */}
      {notification && (
        <div className="fixed bottom-6 right-6 z-50 bg-gray-900 text-white text-xs px-4 py-3 rounded-xl shadow-lg flex items-center gap-3">
          <span>{notification}</span>
          <button onClick={() => setNotification(null)} className="text-gray-400 hover:text-white">✕</button>
        </div>
      )}

      {/* Modal archivo */}
      {confirmArchive && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className={`${panel} border rounded-2xl p-6 max-w-sm w-full mx-4`}>
            <h3 className={`text-sm font-semibold ${text} mb-2`}>Archive this client?</h3>
            <p className={`text-xs ${subtext} mb-4`}>
              <strong>{confirmArchive.first_name} {confirmArchive.last_name}</strong> is currently <strong>{statusLabel(confirmArchive.status)}</strong>. Are you sure you want to archive them?
            </p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmArchive(null)} className={`flex-1 px-4 py-2 text-xs border rounded-lg transition ${darkMode ? 'border-gray-600 text-gray-300 hover:bg-gray-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                Cancel
              </button>
              <button onClick={() => archiveClient(confirmArchive)} className="flex-1 px-4 py-2 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition">
                Yes, archive
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal eliminar cliente */}
      {confirmDeleteClient && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className={`${panel} border rounded-2xl p-6 max-w-sm w-full mx-4`}>
            <h3 className={`text-sm font-semibold ${text} mb-2`}>Delete this client?</h3>
            <p className={`text-xs ${subtext} mb-4`}>
              <strong>{confirmDeleteClient.first_name} {confirmDeleteClient.last_name}</strong> and all their documents will be permanently deleted. This cannot be undone.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmDeleteClient(null)} className={`flex-1 px-4 py-2 text-xs border rounded-lg transition ${darkMode ? 'border-gray-600 text-gray-300 hover:bg-gray-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                Cancel
              </button>
              <button onClick={() => deleteClient(confirmDeleteClient)} className="flex-1 px-4 py-2 text-xs bg-red-500 text-white rounded-lg hover:bg-red-600 transition">
                Yes, delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal eliminar documento */}
      {confirmDeleteDoc && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className={`${panel} border rounded-2xl p-6 max-w-sm w-full mx-4`}>
            <h3 className={`text-sm font-semibold ${text} mb-2`}>Delete this document?</h3>
            <p className={`text-xs ${subtext} mb-4`}>
              <strong>{confirmDeleteDoc.file_name}</strong> will be permanently deleted. This cannot be undone.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmDeleteDoc(null)} className={`flex-1 px-4 py-2 text-xs border rounded-lg transition ${darkMode ? 'border-gray-600 text-gray-300 hover:bg-gray-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                Cancel
              </button>
              <button onClick={() => deleteDocument(confirmDeleteDoc)} className="flex-1 px-4 py-2 text-xs bg-red-500 text-white rounded-lg hover:bg-red-600 transition">
                Yes, delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Top nav */}
      <div className={`flex items-center justify-between px-6 py-3 border-b ${darkMode ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-white'}`}>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-blue-600" />
          <span className={`text-sm font-medium ${text}`}>TaxFlow</span>
          <span className={`text-xs ml-2 px-2 py-0.5 rounded-full ${darkMode ? 'bg-gray-700 text-gray-400' : 'bg-gray-100 text-gray-500'}`}>
            {profile?.role === 'admin' ? 'Admin' : 'Team Member'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-xs ${subtext}`}>{profile?.full_name}</span>
          <button
            onClick={() => router.push('/admin/dashboard')}
            className={`text-xs px-3 py-1.5 rounded-lg border transition ${darkMode ? 'border-gray-600 text-gray-300 hover:bg-gray-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}
          >
            Dashboard
          </button>
          {profile?.role === 'admin' && (
            <button onClick={generateClientLink} className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition">
              + New client link
            </button>
          )}
          <button
            onClick={() => {
              const next = !darkMode
              setDarkMode(next)
              localStorage.setItem('darkMode', String(next))
            }}
            className={`p-1.5 rounded-lg border ${darkMode ? 'border-gray-600 text-gray-300 hover:bg-gray-700' : 'border-gray-200 text-gray-500 hover:bg-gray-100'} transition`}
          >
            {darkMode ? '☀️' : '🌙'}
          </button>
          <button
            onClick={handleLogout}
            className={`text-xs px-3 py-1.5 rounded-lg border transition ${darkMode ? 'border-gray-600 text-gray-300 hover:bg-gray-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}
          >
            Sign out
          </button>
        </div>
      </div>

      <div className="flex h-[calc(100vh-49px)]">
        {/* Sidebar */}
        <div className={`w-64 border-r ${sidebar} flex flex-col`}>
          <div className={`flex border-b ${darkMode ? 'border-gray-700' : 'border-gray-100'}`}>
            <button
              onClick={() => { setShowArchive(false); setSelected(null) }}
              className={`flex-1 py-2.5 text-xs font-medium transition ${!showArchive ? 'text-blue-600 border-b-2 border-blue-600' : subtext}`}
            >
              Clients
            </button>
            <button
              onClick={() => { setShowArchive(true); setSelected(null) }}
              className={`flex-1 py-2.5 text-xs font-medium transition ${showArchive ? 'text-blue-600 border-b-2 border-blue-600' : subtext}`}
            >
              Archive {archivedClients.length > 0 && `(${archivedClients.length})`}
            </button>
          </div>

          <div className="p-3">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search client..."
              className={`w-full border rounded-lg px-3 py-1.5 text-xs ${inputClass}`}
            />
          </div>

          {!showArchive && (
            <div className="flex gap-1 px-3 pb-2 flex-wrap">
              {['all', 'pending', 'in_progress', 'complete'].map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-2 py-1 rounded-full text-xs transition ${filter === f ? (darkMode ? 'bg-gray-600 text-gray-100' : 'bg-gray-200 text-gray-700') : `${subtext} ${hover}`}`}
                >
                  {f === 'all' ? 'All' : f === 'in_progress' ? 'Active' : f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
          )}

          <p className={`text-xs ${subtext} px-3 pb-2`}>{filteredClients.length} client{filteredClients.length !== 1 ? 's' : ''}</p>

          <div className="overflow-y-auto flex-1">
            {filteredClients.map((client, i) => (
              <div
                key={client.id}
                onClick={() => selectClient(client)}
                className={`group flex items-center gap-3 px-3 py-2.5 cursor-pointer transition ${selected?.id === client.id ? selectedBg : hover}`}
              >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium flex-shrink-0 ${avatarColor(i)}`}>
                  {initials(client)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm ${text} truncate`}>{client.first_name} {client.last_name}</p>
                  <p className={`text-xs ${subtext}`}>{client.assigned_to || 'Unassigned'}</p>
                </div>
                {showArchive ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); unarchiveClient(client) }}
                    title="Restore to active"
                    className={`opacity-0 group-hover:opacity-100 transition p-1 rounded ${darkMode ? 'hover:bg-gray-600' : 'hover:bg-gray-200'}`}
                  >
                    <svg className="w-3.5 h-3.5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                  </button>
                ) : (
                  <>
                    <button
                      onClick={(e) => handleArchiveClick(e, client)}
                      title="Archive client"
                      className={`opacity-0 group-hover:opacity-100 transition p-1 rounded ${darkMode ? 'hover:bg-gray-600' : 'hover:bg-gray-200'}`}
                    >
                      <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                      </svg>
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmDeleteClient(client) }}
                      title="Delete client"
                      className={`opacity-0 group-hover:opacity-100 transition p-1 rounded ${darkMode ? 'hover:bg-gray-600' : 'hover:bg-gray-200'}`}
                    >
                      <svg className="w-3.5 h-3.5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </>
                )}
                {!showArchive && <div className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDot(client.status)}`} />}
              </div>
            ))}
            {filteredClients.length === 0 && (
              <p className={`text-xs ${subtext} text-center py-8`}>
                {showArchive ? 'No archived clients' : 'No clients found'}
              </p>
            )}
          </div>
        </div>

        {/* Main panel */}
        {selected ? (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="flex items-start justify-between mb-6">
              <div>
                <h2 className={`text-xl font-semibold ${text}`}>{selected.first_name} {selected.last_name}</h2>
                <p className={`text-sm ${subtext} mt-0.5`}>{selected.email} · {selected.state} · {selected.marital_status} · {selected.fiscal_year}</p>
                <p className={`text-xs ${subtext} mt-0.5`}>{selected.phone}</p>
              </div>
              <span className={`text-xs font-medium px-3 py-1 rounded-full ${statusColor(selected.status)}`}>
                {statusLabel(selected.status)}
              </span>
            </div>

            <div className="grid grid-cols-4 gap-3 mb-6">
              {[
                { label: 'Documents', value: documents.length },
                { label: 'Tax year', value: selected.fiscal_year },
                { label: 'Status', value: statusLabel(selected.status) },
                { label: 'Joined', value: new Date(selected.created_at).toLocaleString().replace(',', ' -') },
              ].map(s => (
                <div key={s.label} className={`${panel} border rounded-xl p-4`}>
                  <p className={`text-xs ${subtext} mb-1`}>{s.label}</p>
                  <p className={`text-lg font-semibold ${text}`}>{s.value}</p>
                </div>
              ))}
              <div className={`${panel} border rounded-xl p-4`}>
                <p className={`text-xs ${subtext} mb-1`}>Assigned to</p>
                {profile?.role === 'admin' ? (
                  <select
                    value={selected.assigned_to || 'Unassigned'}
                    onChange={e => updateAssignee(e.target.value)}
                    className={`w-full text-sm font-medium bg-transparent ${text} border-none outline-none cursor-pointer`}
                  >
                    {TEAM_MEMBERS.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                ) : (
                  <p className={`text-sm font-semibold ${text}`}>{selected.assigned_to || 'Unassigned'}</p>
                )}
              </div>
            </div>

            {/* Documents */}
            <div className={`${panel} border rounded-xl p-4 mb-4`}>
              <p className={`text-xs font-medium ${subtext} uppercase tracking-wider mb-3`}>Documents</p>
              {documents.length === 0 ? (
                <p className={`text-sm ${subtext}`}>No documents uploaded yet.</p>
              ) : (
                documents.map(doc => (
                  <div key={doc.id} className={`flex items-center gap-3 py-2.5 border-b ${divider} last:border-0`}>
                    <div className="w-7 h-7 bg-red-50 rounded-lg flex items-center justify-center flex-shrink-0">
                      <svg className="w-3.5 h-3.5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                        <polyline points="14 2 14 8 20 8" strokeWidth={2} />
                      </svg>
                    </div>
                    <span className={`text-sm ${text} flex-1 truncate`}>{doc.file_name}</span>
                    <span className={`text-xs ${subtext}`}>{new Date(doc.uploaded_at).toLocaleString().replace(',', ' -')}</span>
                    <button onClick={() => getDownloadUrl(doc.file_path)} className="text-xs text-blue-500 hover:text-blue-700 transition">View</button>
                    <button onClick={() => setConfirmDeleteDoc(doc)} className="text-xs text-red-400 hover:text-red-600 transition">Delete</button>
                  </div>
                ))
              )}
            </div>

            {/* Client notes */}
            {selected.notes && (
              <div className={`${panel} border rounded-xl p-4 mb-4`}>
                <p className={`text-xs font-medium ${subtext} uppercase tracking-wider mb-2`}>Client notes</p>
                <p className={`text-sm ${subtext}`}>{selected.notes}</p>
              </div>
            )}

            {/* Internal notes */}
            <div className={`${panel} border rounded-xl p-4 mb-4`}>
              <p className={`text-xs font-medium ${subtext} uppercase tracking-wider mb-3`}>Internal team notes</p>
              <div className="space-y-3 mb-4 max-h-48 overflow-y-auto">
                {notes.length === 0 ? (
                  <p className={`text-sm ${subtext}`}>No internal notes yet.</p>
                ) : (
                  notes.map(note => (
                    <div key={note.id} className={`p-3 rounded-lg ${darkMode ? 'bg-gray-700' : 'bg-gray-50'}`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className={`text-xs font-medium ${text}`}>{note.author}</span>
                        <span className={`text-xs ${subtext}`}>{new Date(note.created_at).toLocaleString().replace(',', ' -')}</span>
                      </div>
                      <p className={`text-sm ${subtext}`}>{note.content}</p>
                    </div>
                  ))
                )}
              </div>
              <div className="flex gap-2">
                <input
                  value={newNote}
                  onChange={e => setNewNote(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && addNote()}
                  placeholder="Write an internal note..."
                  className={`flex-1 border rounded-lg px-3 py-1.5 text-xs ${inputClass}`}
                />
                <button
                  onClick={addNote}
                  disabled={!newNote.trim()}
                  className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 transition disabled:opacity-40"
                >
                  Add
                </button>
              </div>
            </div>

            {/* Actions */}
            {!showArchive && (
              <div className="flex gap-2">
                <button
                  onClick={() => updateStatus('pending')}
                  className={`px-4 py-2 text-xs border rounded-lg transition ${darkMode ? 'border-gray-600 text-gray-300 hover:bg-gray-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                >
                  Mark as pending
                </button>
                <button
                  onClick={() => updateStatus('in_progress')}
                  className={`px-4 py-2 text-xs border rounded-lg transition ${darkMode ? 'border-gray-600 text-gray-300 hover:bg-gray-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                >
                  Mark as active
                </button>
                <button
                  onClick={() => updateStatus('complete')}
                  className="px-4 py-2 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
                >
                  Mark as complete
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <p className={`text-sm ${subtext}`}>
              {showArchive ? 'Select an archived client to view their details' : 'Select a client to view their details'}
            </p>
          </div>
        )}
      </div>
    </main>
  )
}
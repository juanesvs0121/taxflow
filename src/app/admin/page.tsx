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
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [newNote, setNewNote] = useState('')
  const [showArchive, setShowArchive] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState<Client | null>(null)
  const [notification, setNotification] = useState<string | null>(null)
  const [confirmDeleteClient, setConfirmDeleteClient] = useState<Client | null>(null)
  const [confirmDeleteDoc, setConfirmDeleteDoc] = useState<Document | null>(null)
  const [panelVisible, setPanelVisible] = useState(false)

  useEffect(() => { setMounted(true) }, [])
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
            setNotification(`${client.first_name} ${client.last_name} just uploaded a new file`)
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
      .from('profiles').select('*').eq('id', user.id).single()
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
    setPanelVisible(false)
    setTimeout(() => {
      setSelected(client)
      fetchDocuments(client.id)
      fetchNotes(client.id)
      setPanelVisible(true)
    }, 150)
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
      .select().single()
    if (data) setNotes([...notes, data])
    setNewNote('')
  }

  const handleArchiveClick = (e: React.MouseEvent, client: Client) => {
    e.stopPropagation()
    if (client.status === 'complete') archiveClient(client)
    else setConfirmArchive(client)
  }

  const archiveClient = async (client: Client) => {
    await supabase.from('clients').update({ archived: true }).eq('id', client.id)
    setClients(clients.map(c => c.id === client.id ? { ...c, archived: true } : c))
    if (selected?.id === client.id) { setSelected(null); setPanelVisible(false) }
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
    if (selected?.id === client.id) { setSelected(null); setPanelVisible(false) }
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

  const statusLabel = (status: string) => {
    if (status === 'complete') return 'Complete'
    if (status === 'in_progress') return 'In progress'
    return 'Pending'
  }

  const statusBadge = (status: string) => {
    if (status === 'complete') return 'bg-emerald-50 text-emerald-700 border border-emerald-200'
    if (status === 'in_progress') return 'bg-blue-50 text-blue-700 border border-blue-200'
    return 'bg-amber-50 text-amber-700 border border-amber-200'
  }

  const statusDot = (status: string) => {
    if (status === 'complete') return 'bg-emerald-500'
    if (status === 'in_progress') return 'bg-blue-500'
    return 'bg-amber-400'
  }

  const avatarColors = [
    'bg-violet-100 text-violet-600',
    'bg-sky-100 text-sky-600',
    'bg-emerald-100 text-emerald-600',
    'bg-amber-100 text-amber-600',
    'bg-rose-100 text-rose-600',
  ]

  const initials = (c: Client) => `${c.first_name[0]}${c.last_name[0]}`.toUpperCase()

  const formatDateUS = (dateString: string) => {
    const d = new Date(dateString)
    return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
  }

  if (!mounted || loading) {
    return (
      <main className="min-h-screen bg-[#fafaf8] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#1c1c1e] flex items-center justify-center">
            <span className="text-[#fafaf8] text-xs font-medium">Tf</span>
          </div>
          <p className="text-sm text-stone-500">Loading...</p>
        </div>
      </main>
    )
  }

  const modalBase = "fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-50 animate-in fade-in duration-200"
  const modalCard = "bg-white border border-stone-100 rounded-2xl p-6 max-w-sm w-full mx-4 shadow-xl animate-in zoom-in-95 duration-200"

  return (
    <main className="min-h-screen bg-[#fafaf8] flex flex-col" style={{ fontFamily: 'var(--font-sans)' }}>

      {/* Notificación */}
      {notification && (
        <div className="fixed bottom-6 right-6 z-50 bg-[#1c1c1e] text-white text-xs px-4 py-3 rounded-xl flex items-center gap-3 shadow-lg animate-in slide-in-from-bottom-4 duration-300">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span>{notification}</span>
          <button onClick={() => setNotification(null)} className="text-white/40 hover:text-white transition-colors ml-1">✕</button>
        </div>
      )}

      {/* Modal archivo */}
      {confirmArchive && (
        <div className={modalBase}>
          <div className={modalCard}>
            <h3 className="text-sm font-medium text-stone-800 mb-1">Archive this client?</h3>
            <p className="text-xs text-stone-500 mb-5">
              <strong className="text-stone-700 capitalize">{confirmArchive.first_name} {confirmArchive.last_name}</strong> is currently <strong className="text-stone-700">{statusLabel(confirmArchive.status)}</strong>. Are you sure?
            </p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmArchive(null)} className="flex-1 px-4 py-2 text-xs border border-stone-200 rounded-lg text-stone-600 hover:bg-stone-50 transition-colors">Cancel</button>
              <button onClick={() => archiveClient(confirmArchive)} className="flex-1 px-4 py-2 text-xs bg-[#1c1c1e] text-white rounded-lg hover:bg-stone-800 transition-colors">Archive</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal eliminar cliente */}
      {confirmDeleteClient && (
        <div className={modalBase}>
          <div className={modalCard}>
            <h3 className="text-sm font-medium text-stone-800 mb-1">Delete this client?</h3>
            <p className="text-xs text-stone-500 mb-5">
              <strong className="text-stone-700 capitalize">{confirmDeleteClient.first_name} {confirmDeleteClient.last_name}</strong> and all their documents will be permanently deleted.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmDeleteClient(null)} className="flex-1 px-4 py-2 text-xs border border-stone-200 rounded-lg text-stone-600 hover:bg-stone-50 transition-colors">Cancel</button>
              <button onClick={() => deleteClient(confirmDeleteClient)} className="flex-1 px-4 py-2 text-xs bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors">Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal eliminar doc */}
      {confirmDeleteDoc && (
        <div className={modalBase}>
          <div className={modalCard}>
            <h3 className="text-sm font-medium text-stone-800 mb-1">Delete this document?</h3>
            <p className="text-xs text-stone-500 mb-5">
              <strong className="text-stone-700">{confirmDeleteDoc.file_name}</strong> will be permanently deleted.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmDeleteDoc(null)} className="flex-1 px-4 py-2 text-xs border border-stone-200 rounded-lg text-stone-600 hover:bg-stone-50 transition-colors">Cancel</button>
              <button onClick={() => deleteDocument(confirmDeleteDoc)} className="flex-1 px-4 py-2 text-xs bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors">Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Topbar */}
      <div className="flex items-center justify-between px-5 py-3 bg-[#fafaf8] border-b border-stone-100">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-[#1c1c1e] flex items-center justify-center">
            <span className="text-[#fafaf8] text-xs font-medium tracking-tight">Tf</span>
          </div>
          <span className="text-sm font-medium text-stone-800 tracking-tight">
            Tax<span className="text-emerald-500">Flow</span>
          </span>
          <span className="text-xs px-2 py-0.5 rounded-md bg-stone-100 text-stone-500">
            {profile?.role === 'admin' ? 'Admin' : 'Member'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-stone-500">{profile?.full_name}</span>
          <button
            onClick={() => router.push('/admin/dashboard')}
            className="text-xs px-3 py-1.5 rounded-lg border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 transition-colors"
          >
            Dashboard
          </button>
          {profile?.role === 'admin' && (
            <button
              onClick={generateClientLink}
              className="text-xs px-3 py-1.5 rounded-lg bg-[#1c1c1e] text-white hover:bg-stone-800 transition-colors"
            >
              + New link
            </button>
          )}
          <button
            onClick={handleLogout}
            className="text-xs px-3 py-1.5 rounded-lg border border-stone-200 bg-white text-stone-500 hover:bg-stone-50 transition-colors"
          >
            Sign out
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">

        {/* Sidebar */}
        <div className="w-60 bg-white border-r border-stone-100 flex flex-col">
          <div className="p-3 pb-2">
            <p className="text-[10px] font-medium text-stone-400 uppercase tracking-widest mb-2.5">Clients</p>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name..."
              className="w-full bg-[#fafaf8] border-none rounded-lg px-3 py-1.5 text-xs text-stone-600 placeholder-stone-400 outline-none"
            />
          </div>

          {!showArchive && (
            <div className="flex gap-1 px-3 pb-2">
              {['all', 'pending', 'in_progress', 'complete'].map(f => {
                const isActive = filter === f
                return (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`text-[10px] px-2.5 py-1 rounded-md font-medium border transition-all ${
                      isActive
                        ? f === 'pending'     ? 'bg-amber-50 text-amber-700 border-amber-200'
                        : f === 'in_progress' ? 'bg-blue-50 text-blue-700 border-blue-200'
                        : f === 'complete'    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        :                      'bg-[#1c1c1e] text-white border-transparent'
                        : 'text-stone-500 border-transparent hover:text-stone-800 hover:bg-stone-50'
                    }`}
                  >
                    {f === 'all' ? 'All' : f === 'in_progress' ? 'Active' : f.charAt(0).toUpperCase() + f.slice(1)}
                  </button>
                )
              })}
            </div>
          )}

          <p className="text-[10px] text-stone-500 px-3 pb-1.5">
            {filteredClients.length} client{filteredClients.length !== 1 ? 's' : ''}
          </p>

          <div className="flex-1 overflow-y-auto px-2 pb-2">
            {filteredClients.map((client, i) => (
              <div
                key={client.id}
                onClick={() => selectClient(client)}
                className={`group flex items-center gap-2.5 px-2.5 py-2 rounded-xl cursor-pointer transition-all duration-150 mb-0.5 border-l-2 ${
  selected?.id === client.id
    ? client.status === 'complete'    ? 'bg-emerald-50 border-l-emerald-500' :
      client.status === 'in_progress' ? 'bg-blue-50 border-l-blue-500' :
                                        'bg-amber-50 border-l-amber-400': 
                                        'hover:bg-stone-50 border-l-transparent'
}`}
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-[11px] font-medium flex-shrink-0 transition-colors ${
                  selected?.id === client.id ? avatarColors[i % avatarColors.length] : avatarColors[i % avatarColors.length]
                }`}>
                  {initials(client)}
                </div>
                <div className="flex-1 min-w-0">
                 <p className={`text-xs font-medium truncate capitalize transition-colors ${
  selected?.id === client.id ? 'text-stone-800' : 'text-stone-700'
}`}>
                    {client.first_name} {client.last_name}
                  </p>
                  <p className={`text-[10px] truncate transition-colors ${
  selected?.id === client.id ? 'text-stone-500' : 'text-stone-500'
}`}>
                    {client.assigned_to || 'Unassigned'} · {documents.length > 0 && selected?.id === client.id ? `${documents.length} docs` : ''}
                  </p>
                </div>
                {showArchive ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); unarchiveClient(client) }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-white/10"
                    title="Restore"
                  >
                    <svg className="w-3 h-3 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                  </button>
                ) : (
                  <div className="flex items-center gap-0.5">
                    <button
                      onClick={(e) => handleArchiveClick(e, client)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-stone-100"
                      title="Archive"
                    >
                      <svg className={`w-3 h-3 ${selected?.id === client.id ? 'text-white/40' : 'text-stone-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                      </svg>
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmDeleteClient(client) }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-red-50"
                      title="Delete"
                    >
                      <svg className="w-3 h-3 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                    <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ml-0.5 ${statusDot(client.status)}`} />
                  </div>
                )}
              </div>
            ))}
            {filteredClients.length === 0 && (
              <p className="text-xs text-stone-500 text-center py-8">
                {showArchive ? 'No archived clients' : 'No clients found'}
              </p>
            )}
          </div>

          <div className="border-t border-stone-100">
            <div className="flex">
              <button
                onClick={() => { setShowArchive(false); setSelected(null); setPanelVisible(false) }}
                className={`flex-1 py-2.5 text-xs transition-colors border-t-[1.5px] ${
                  !showArchive ? 'text-stone-700 font-medium border-stone-700' : 'text-stone-400 border-transparent hover:text-stone-600'
                }`}
              >
                Active
              </button>
              <button
                onClick={() => { setShowArchive(true); setSelected(null); setPanelVisible(false) }}
                className={`flex-1 py-2.5 text-xs transition-colors border-t-[1.5px] ${
                  showArchive ? 'text-stone-700 font-medium border-stone-700' : 'text-stone-400 border-transparent hover:text-stone-600'
                }`}
              >
                Archive {archivedClients.length > 0 && `(${archivedClients.length})`}
              </button>
            </div>
          </div>
        </div>

        {/* Main panel */}
        {selected ? (
          <div className={`flex-1 flex flex-col overflow-hidden transition-all duration-200 ${panelVisible ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-2'}`}>

            {/* Hero */}
            <div className={`bg-white border-b border-stone-100 px-6 py-4 border-l-4 transition-colors duration-500 ${
              selected.status === 'complete'    ? 'border-l-emerald-500' :
              selected.status === 'in_progress' ? 'border-l-blue-500' :
                                                  'border-l-amber-400'
            }`}>
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h2 className="text-xl font-medium text-stone-800 tracking-tight capitalize">
                    {selected.first_name} {selected.last_name}
                  </h2>
                  <p className="text-xs text-stone-500 mt-0.5">
                    {selected.email} · {selected.state} · {selected.marital_status} · {selected.phone}
                  </p>
                </div>
                <span className={`text-[10px] font-medium px-2.5 py-1 rounded-md ${statusBadge(selected.status)}`}>
                  {statusLabel(selected.status)}
                </span>
              </div>

              <div className="grid grid-cols-4 gap-2">
                {[
                  { label: 'Documents', value: documents.length, accent: true },
                  { label: 'Tax year',  value: selected.fiscal_year },
                  { label: 'Joined',    value: formatDateUS(selected.created_at) },
                ].map(s => (
                  <div key={s.label} className="bg-[#fafaf8] border border-stone-100 rounded-xl px-3 py-2.5">
                    <p className="text-[9px] font-medium text-stone-500 uppercase tracking-widest mb-1">{s.label}</p>
                    <p className={`text-sm font-medium tracking-tight ${s.accent ? 'text-emerald-600' : 'text-stone-700'}`}>
                      {s.value}
                    </p>
                  </div>
                ))}
                <div className="bg-[#fafaf8] border border-stone-100 rounded-xl px-3 py-2.5">
                  <p className="text-[9px] font-medium text-stone-500 uppercase tracking-widest mb-1">Assigned to</p>
                  {profile?.role === 'admin' ? (
                    <select
                      value={selected.assigned_to || 'Unassigned'}
                      onChange={e => updateAssignee(e.target.value)}
                      className="text-sm font-medium text-stone-700 bg-transparent border-none outline-none cursor-pointer w-full tracking-tight"
                    >
                      {TEAM_MEMBERS.map(m => <option key={m}>{m}</option>)}
                    </select>
                  ) : (
                    <p className="text-sm font-medium text-stone-700 tracking-tight">
                      {selected.assigned_to || 'Unassigned'}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Scroll area */}
            <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-3">

              {/* Documents */}
              <div className="bg-white border border-stone-100 rounded-2xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-stone-50">
                  <p className="text-[10px] font-medium text-stone-500 uppercase tracking-widest">Documents</p>
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-md transition-colors duration-500 ${
                    documents.length === 0            ? 'bg-stone-100 text-stone-500' :
                    selected.status === 'complete'    ? 'bg-emerald-50 text-emerald-700' :
                    selected.status === 'in_progress' ? 'bg-blue-50 text-blue-700' :
                                                        'bg-amber-50 text-amber-700'
                  }`}>
                    {documents.length} file{documents.length !== 1 ? 's' : ''}
                  </span>
                </div>
                {documents.length === 0 ? (
                  <p className="text-xs text-stone-500 px-4 py-4">No documents uploaded yet.</p>
                ) : (
                  documents.map((doc, i) => (
                    <div
                      key={doc.id}
                      className={`flex items-center gap-3 px-4 py-2.5 hover:bg-stone-50 transition-colors ${i > 0 ? 'border-t border-stone-50' : ''}`}
                      style={{ animationDelay: `${i * 50}ms` }}
                    >
                      <div className="w-7 h-7 bg-red-50 rounded-lg flex items-center justify-center flex-shrink-0">
                        <svg className="w-3.5 h-3.5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                          <polyline points="14 2 14 8 20 8" strokeWidth={1.5} />
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-stone-600 truncate">{doc.file_name}</p>
                        <p className="text-[10px] text-stone-500 mt-0.5">{formatDateUS(doc.uploaded_at)}</p>
                      </div>
                      <button
                        onClick={() => getDownloadUrl(doc.file_path)}
                        className={`text-[10px] font-medium transition-colors ${
                          selected.status === 'complete'    ? 'text-emerald-600 hover:text-emerald-800' :
                          selected.status === 'in_progress' ? 'text-blue-600 hover:text-blue-800' :
                                                              'text-amber-600 hover:text-amber-800'
                        }`}
                      >
                        View
                      </button>
                      <button
                        onClick={() => setConfirmDeleteDoc(doc)}
                        className="text-[10px] text-red-400 hover:text-red-600 transition-colors ml-2"
                      >
                        Delete
                      </button>
                    </div>
                  ))
                )}
              </div>

              {/* Client notes */}
              {selected.notes && (
                <div className={`bg-white border border-stone-100 rounded-2xl px-4 py-3 border-l-2 transition-colors duration-500 ${
                  selected.status === 'complete'    ? 'border-l-emerald-500' :
                  selected.status === 'in_progress' ? 'border-l-blue-500' :
                                                      'border-l-amber-400'
                }`}>
                  <p className="text-[10px] font-medium text-stone-500 uppercase tracking-widest mb-2">Client notes</p>
                  <p className="text-xs text-stone-600 leading-relaxed">{selected.notes}</p>
                </div>
              )}

              {/* Internal notes */}
              <div className="bg-white border border-stone-100 rounded-2xl overflow-hidden">
                <div className="px-4 py-3 border-b border-stone-50">
                  <p className="text-[10px] font-medium text-stone-500 uppercase tracking-widest">Internal notes</p>
                </div>
                <div className="max-h-44 overflow-y-auto">
                  {notes.length === 0 ? (
                    <p className="text-xs text-stone-500 px-4 py-4">No notes yet.</p>
                  ) : (
                    notes.map((note, i) => (
                      <div
                        key={note.id}
                        className={`mx-4 my-2 bg-[#fafaf8] rounded-xl px-3 py-2.5 border-l-2 transition-colors duration-500 ${
                          selected.status === 'complete'    ? 'border-l-emerald-500' :
                          selected.status === 'in_progress' ? 'border-l-blue-500' :
                                                              'border-l-amber-400'
                        }`}
                        style={{ animationDelay: `${i * 60}ms` }}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] font-medium text-stone-600">{note.author}</span>
                          <span className="text-[10px] text-stone-500">{new Date(note.created_at).toLocaleDateString('en-US')}</span>
                        </div>
                        <p className="text-xs text-stone-600 leading-relaxed">{note.content}</p>
                      </div>
                    ))
                  )}
                </div>
                <div className="flex gap-2 px-4 py-3 border-t border-stone-50">
                  <input
                    value={newNote}
                    onChange={e => setNewNote(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addNote()}
                    placeholder="Leave a note for the team..."
                    className="flex-1 bg-[#fafaf8] border-none rounded-lg px-3 py-2 text-xs text-stone-600 placeholder-stone-400 outline-none"
                  />
                  <button
                    onClick={addNote}
                    disabled={!newNote.trim()}
                    className="px-3 py-2 bg-[#1c1c1e] text-white text-xs rounded-lg hover:bg-stone-800 transition-colors disabled:opacity-40"
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>

            {/* Footer actions */}
            {!showArchive && (
              <div className="bg-white border-t border-stone-100 px-6 py-3 flex items-center gap-2">
                <button
                  onClick={() => updateStatus('pending')}
                  className="px-4 py-2 text-xs border border-stone-200 rounded-lg text-stone-600 hover:bg-stone-50 transition-colors"
                >
                  Mark as pending
                </button>
                <button
                  onClick={() => updateStatus('in_progress')}
                  className="px-4 py-2 text-xs border border-blue-200 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors"
                >
                  Mark as active
                </button>
                <button
                  onClick={() => updateStatus('complete')}
                  className="px-4 py-2 text-xs bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors ml-auto"
                >
                  Mark as complete ✓
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="w-10 h-10 rounded-xl bg-stone-100 flex items-center justify-center mx-auto mb-3">
                <svg className="w-5 h-5 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <p className="text-xs text-stone-500">
                {showArchive ? 'Select an archived client' : 'Select a client to get started'}
              </p>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
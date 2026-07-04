import { useEffect, useMemo, useState } from "react";
import { api, setAuth } from "../api";
import {
  cacheTasks,
  getAllTasksLocal,
  putTaskLocal,
  removeTaskLocal,
  queue,
  type OutboxOp,
} from "../offline/db";
import { syncNow } from "../offline/sync"; 

type Status = "Pendiente" | "En Progreso" | "Completada";

type Task = {
  _id: string;
  title: string;
  description?: string;
  status: Status;
  clienteId?: string;
  createdAt?: string;
  deleted?: boolean;
  pending?: boolean;
};

type UserProfile = {
  name: string;
  email: string;
  role: string;
};

const isLocalId = (id: string) => !/^[a-f0-9]{24}$/i.test(id);

function normalizeTask(x: any): Task {
  return {
    _id: String(x?._id ?? x?.id),
    title: String(x?.title ?? "(sin título)"),
    description: x?.description ?? "",
    status:
      x?.status === "Completada" ||
      x?.status === "En Progreso" ||
      x?.status === "Pendiente"
        ? x.status
        : "Pendiente",
    clienteId: x?.clienteId,
    createdAt: x?.createdAt,
    deleted: !!x?.deleted,
    pending: !!x?.pending,
  };
}

export default function Dashboard() {
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "completed">("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [editingDescription, setEditingDescription] = useState("");
  const [online, setOnline] = useState<boolean>(navigator.onLine);

  const [showProfile, setShowProfile] = useState(false);
  const [profile, setProfile] = useState<UserProfile>({
    name: "Cargando...",
    email: "...",
    role: "Usuario",
  });

  useEffect(() => {
    setAuth(localStorage.getItem("token"));

    const on = async () => {
      setOnline(true);
      await syncNow();
      await loadFromServer();
    };
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);

    (async () => {
      const local = await getAllTasksLocal();
      if (local?.length) setTasks(local.map(normalizeTask));
      await loadFromServer();
      await syncNow();
      await loadFromServer();
      fetchProfile();
    })();

    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  async function fetchProfile() {
    try {
      setProfile({
        name: "Juan Pérez",
        email: "juan.perez@example.com",
        role: "Administrador del Sistema",
      });
    } catch (err) {
      console.error("Error cargando perfil", err);
    }
  }

  async function loadFromServer() {
    try {
      const { data } = await api.get("/tasks");
      const raw = Array.isArray(data?.items) ? data.items : [];
      const list = raw.map(normalizeTask);
      setTasks(list);
      await cacheTasks(list);
    } catch {
      // Offline fallback
    } finally {
      setLoading(false);
    }
  }

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    const d = description.trim();
    if (!t) return;

    const clienteId = crypto.randomUUID();
    const localTask = normalizeTask({
      _id: clienteId,
      title: t,
      description: d,
      status: "Pendiente" as Status,
      pending: !navigator.onLine,
    });

    setTasks((prev) => [localTask, ...prev]);
    await putTaskLocal(localTask);
    setTitle("");
    setDescription("");

    if (!navigator.onLine) {
      const op: OutboxOp = {
        id: "op-" + clienteId,
        op: "create",
        clienteId,
        data: localTask,
        ts: Date.now(),
      };
      await queue(op);
      return;
    }

    try {
      const { data } = await api.post("/tasks", { title: t, description: d });
      const created = normalizeTask(data?.task ?? data);
      setTasks((prev) => prev.map((x) => (x._id === clienteId ? created : x)));
      await putTaskLocal(created);
    } catch {
      const op: OutboxOp = {
        id: "op-" + clienteId,
        op: "create",
        clienteId,
        data: localTask,
        ts: Date.now(),
      };
      await queue(op);
    }
  }

  function startEdit(task: Task) {
    setEditingId(task._id);
    setEditingTitle(task.title);
    setEditingDescription(task.description ?? "");
  }

  async function saveEdit(taskId: string) {
    const newTitle = editingTitle.trim();
    const newDesc = editingDescription.trim();
    if (!newTitle) return;

    const before = tasks.find((t) => t._id === taskId);
    const patched = { ...before, title: newTitle, description: newDesc } as Task;

    setTasks((prev) => prev.map((t) => (t._id === taskId ? patched : t)));
    await putTaskLocal(patched);
    setEditingId(null);

    if (!navigator.onLine) {
      await queue({
        id: "upd-" + taskId,
        op: "update",
        clienteId: isLocalId(taskId) ? taskId : undefined,
        serverId: isLocalId(taskId) ? undefined : taskId,
        data: { title: newTitle, description: newDesc },
        ts: Date.now(),
      } as OutboxOp);
      return;
    }

    try {
      await api.put(`/tasks/${taskId}`, { title: newTitle, description: newDesc });
    } catch {
      await queue({
        id: "upd-" + taskId,
        op: "update",
        serverId: taskId,
        data: { title: newTitle, description: newDesc },
        ts: Date.now(),
      } as OutboxOp);
    }
  }

  async function handleStatusChange(task: Task, newStatus: Status) {
    const updated = { ...task, status: newStatus };
    setTasks((prev) => prev.map((x) => (x._id === task._id ? updated : x)));
    await putTaskLocal(updated);

    if (!navigator.onLine) {
      await queue({
        id: "upd-" + task._id,
        op: "update",
        serverId: isLocalId(task._id) ? undefined : task._id,
        clienteId: isLocalId(task._id) ? task._id : undefined,
        data: { status: newStatus },
        ts: Date.now(),
      });
      return;
    }

    try {
      await api.put(`/tasks/${task._id}`, { status: newStatus });
    } catch {
      await queue({
        id: "upd-" + task._id,
        op: "update",
        serverId: task._id,
        data: { status: newStatus },
        ts: Date.now(),
      });
    }
  }

  async function removeTask(taskId: string) {
    const backup = tasks;
    setTasks((prev) => prev.filter((t) => t._id !== taskId));
    await removeTaskLocal(taskId);

    if (!navigator.onLine) {
      await queue({
        id: "del-" + taskId,
        op: "delete",
        serverId: isLocalId(taskId) ? undefined : taskId,
        clienteId: isLocalId(taskId) ? taskId : undefined,
        ts: Date.now(),
      });
      return;
    }

    try {
      await api.delete(`/tasks/${taskId}`);
    } catch {
      setTasks(backup);
      for (const t of backup) await putTaskLocal(t);
      await queue({
        id: "del-" + taskId,
        op: "delete",
        serverId: taskId,
        clienteId: isLocalId(taskId) ? taskId : undefined,
        ts: Date.now(),
      });
    }
  }

  function logout() {
    localStorage.removeItem("token");
    setAuth(null);
    window.location.href = "/";
  }

  const filtered = useMemo(() => {
    let list = tasks;
    if (search.trim()) {
      const s = search.toLowerCase();
      list = list.filter(
        (t) =>
          (t.title || "").toLowerCase().includes(s) ||
          (t.description || "").toLowerCase().includes(s)
      );
    }
    if (filter === "active") list = list.filter((t) => t.status !== "Completada");
    if (filter === "completed") list = list.filter((t) => t.status === "Completada");
    return list;
  }, [tasks, search, filter]);

  const stats = useMemo(() => {
    const total = tasks.length;
    const done = tasks.filter((t) => t.status === "Completada").length;
    return { total, done, pending: total - done };
  }, [tasks]);

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans antialiased pb-12">
      {/* Inyección dinámica de Tailwind CSS para compilar estilos al vuelo */}
      <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet" />

      {/* --- NAVBAR --- */}
      <header className="bg-slate-800/50 backdrop-blur-md border-b border-slate-700 sticky top-0 z-40 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="bg-indigo-600 p-2 rounded-lg text-white shadow-lg shadow-indigo-600/30">
            ⚡
          </div>
          <h1 className="text-xl font-bold bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">
            TaskFlow PWA
          </h1>
        </div>

        <div className="flex items-center space-x-4">
          {/* Indicador de Red */}
          <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium shadow-sm transition-all duration-300 ${
            online ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
          }`}>
            <span className={`w-2 h-2 rounded-full mr-2 animate-pulse ${online ? "bg-emerald-400" : "bg-amber-400"}`} />
            {online ? "En línea" : "Modo Offline"}
          </span>

          {/* Estadísticas rápidas */}
          <div className="hidden md:flex space-x-2 text-xs text-slate-400 bg-slate-900/50 p-1 rounded-lg border border-slate-700/50">
            <span className="px-2 py-1">Total: <strong className="text-slate-200">{stats.total}</strong></span>
            <span className="px-2 py-1">Hechas: <strong className="text-emerald-400">{stats.done}</strong></span>
          </div>

          <button 
            onClick={() => setShowProfile(true)}
            className="flex items-center space-x-2 bg-slate-700 hover:bg-slate-600 transition text-slate-200 px-3 py-1.5 rounded-lg text-sm font-medium border border-slate-600"
          >
            <span>👤 Perfil</span>
          </button>
          
          <button 
            onClick={logout}
            className="bg-red-500/10 hover:bg-red-500 hover:text-white transition text-red-400 px-3 py-1.5 rounded-lg text-sm font-medium border border-red-500/20"
          >
            Salir
          </button>
        </div>
      </header>

      {/* --- MAIN LAYOUT --- */}
      <main className="max-w-5xl mx-auto px-4 mt-8 grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* COLUMNA IZQUIERDA: Formulario & Stats */}
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 shadow-xl grid grid-cols-3 gap-2 text-center">
            <div className="p-2 bg-slate-900/50 rounded-lg">
              <p className="text-xs text-slate-400">Total</p>
              <p className="text-xl font-bold text-slate-200">{stats.total}</p>
            </div>
            <div className="p-2 bg-slate-900/50 rounded-lg">
              <p className="text-xs text-slate-400">Pendientes</p>
              <p className="text-xl font-bold text-amber-400">{stats.pending}</p>
            </div>
            <div className="p-2 bg-slate-900/50 rounded-lg">
              <p className="text-xs text-slate-400">Hechas</p>
              <p className="text-xl font-bold text-emerald-400">{stats.done}</p>
            </div>
          </div>

          <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 shadow-xl">
            <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center">
              <span className="mr-2 text-indigo-400">➕</span> Nueva Tarea
            </h3>
            <form onSubmit={addTask} className="space-y-4">
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="¿Qué vas a hacer hoy?..."
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition"
              />
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Descripción o notas adicionales..."
                rows={3}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition resize-none"
              />
              <button 
                type="submit"
                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm py-2 px-4 rounded-lg shadow-lg shadow-indigo-600/20 transition transform active:scale-98"
              >
                Agregar Tarea
              </button>
            </form>
          </div>
        </div>

        {/* COLUMNA DERECHA: Listado y Buscador */}
        <div className="lg:col-span-2 space-y-4">
          
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 shadow-xl flex flex-col md:flex-row gap-3 items-center justify-between">
            <div className="relative w-full md:w-72">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-500 text-sm">🔍</span>
              <input
                type="text"
                placeholder="Buscar tareas..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-3 py-1.5 text-sm placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition"
              />
            </div>
            
            <div className="flex bg-slate-900 p-1 rounded-lg border border-slate-700 w-full md:w-auto">
              {(["all", "active", "completed"] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setFilter(type)}
                  className={`flex-1 md:flex-none px-4 py-1 text-xs font-medium rounded-md transition ${
                    filter === type 
                      ? "bg-slate-700 text-white shadow-sm" 
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {type === "all" ? "Todas" : type === "active" ? "Activas" : "Hechas"}
                </button>
              ))}
            </div>
          </div>

          {/* Listado */}
          {loading ? (
            <div className="text-center py-12 text-slate-400 text-sm animate-pulse">Cargando tareas de forma segura...</div>
          ) : filtered.length === 0 ? (
            <div className="bg-slate-800/40 border border-dashed border-slate-700 rounded-xl py-12 text-center text-slate-500 text-sm">
              📭 No hay tareas que coincidan con el filtro
            </div>
          ) : (
            <ul className="space-y-3">
              {filtered.map((t) => {
                const isCompleted = t.status === "Completada";
                return (
                  <li 
                    key={t._id} 
                    className={`bg-slate-800 border rounded-xl p-4 shadow-md transition-all duration-200 hover:border-slate-600 flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                      isCompleted ? "border-slate-800 opacity-60" : "border-slate-700"
                    }`}
                  >
                    
                    <div className="flex-1 space-y-2">
                      {editingId === t._id ? (
                        <div className="space-y-2">
                          <input
                            value={editingTitle}
                            onChange={(e) => setEditingTitle(e.target.value)}
                            className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1 text-sm text-slate-100"
                            placeholder="Título"
                            autoFocus
                          />
                          <textarea
                            value={editingDescription}
                            onChange={(e) => setEditingDescription(e.target.value)}
                            className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs text-slate-300 resize-none"
                            placeholder="Descripción"
                            rows={2}
                          />
                        </div>
                      ) : (
                        <div>
                          <div className="flex items-center space-x-2">
                            <span 
                              className={`text-base font-semibold transition-all ${
                                isCompleted ? "line-through text-slate-500" : "text-slate-100"
                              }`}
                              onDoubleClick={() => startEdit(t)}
                            >
                              {t.title}
                            </span>
                            
                            {(t.pending || isLocalId(t._id)) && (
                              <span className="bg-amber-500/10 text-amber-400 text-[10px] px-1.5 py-0.5 rounded border border-amber-500/20 font-medium">
                                Sincronización pendiente
                              </span>
                            )}
                          </div>
                          {t.description && (
                            <p className={`text-xs mt-1 break-words ${isCompleted ? "text-slate-500" : "text-slate-400"}`}>
                              {t.description}
                            </p>
                          )}
                        </div>
                      )}

                      {/* Selector de estado personalizado: COLOR ROSA BAJITO, LETRAS NEGRAS */}
                      <div className="flex items-center space-x-2 pt-1">
                        <span className="text-[11px] text-slate-500 font-medium">Estado:</span>
                        <select
                          value={t.status}
                          onChange={(e) => handleStatusChange(t, e.target.value as Status)}
                          className={`text-xs rounded-lg px-2.5 py-1 font-bold border focus:outline-none cursor-pointer transition shadow-sm text-black ${
                            t.status === "Completada" 
                              ? "bg-emerald-200 border-emerald-300" 
                              : t.status === "En Progreso"
                              ? "bg-sky-200 border-sky-300" 
                              : "bg-[#ffe4e6] border-[#fecdd3]" 
                          }`}
                        >
                          <option value="Pendiente" className="bg-white text-black">Pendiente</option>
                          <option value="En Progreso" className="bg-white text-black">En Progreso</option>
                          <option value="Completada" className="bg-white text-black">Completada</option>
                        </select>
                      </div>
                    </div>

                    {/* Acciones */}
                    <div className="flex items-center justify-end space-x-2 border-t sm:border-t-0 pt-3 sm:pt-0 border-slate-700/60">
                      {editingId === t._id ? (
                        <button 
                          onClick={() => saveEdit(t._id)}
                          className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs px-3 py-1.5 rounded-lg font-medium transition"
                        >
                          Guardar
                        </button>
                      ) : (
                        <button 
                          onClick={() => startEdit(t)}
                          className="p-2 text-slate-400 hover:text-indigo-400 hover:bg-indigo-500/10 rounded-lg transition"
                          title="Editar tarea"
                        >
                          ✏️
                        </button>
                      )}
                      <button 
                        onClick={() => removeTask(t._id)}
                        className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition"
                        title="Eliminar tarea"
                      >
                        🗑️
                      </button>
                    </div>

                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </main>

      {/* --- MODAL DE PERFIL --- */}
      {showProfile && (
        <div 
          className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          onClick={() => setShowProfile(false)}
        >
          <div 
            className="bg-slate-800 border border-slate-700 w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="h-2 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500" />
            
            <div className="p-6">
              <div className="flex items-center justify-between border-b border-slate-700 pb-3 mb-4">
                <h2 className="text-lg font-bold text-slate-200 flex items-center">
                  <span className="mr-2">📋</span> Perfil de Usuario
                </h2>
                <button 
                  onClick={() => setShowProfile(false)}
                  className="text-slate-400 hover:text-slate-200 text-sm p-1 rounded-lg hover:bg-slate-700 transition"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-4 text-sm">
                <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-700/40">
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">Nombre</span>
                  <span className="text-slate-200 font-medium text-base">{profile.name}</span>
                </div>
                
                <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-700/40">
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">Correo Electrónico</span>
                  <span className="text-slate-200 font-medium">{profile.email}</span>
                </div>

                <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-700/40">
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">Rol asignado</span>
                  <span className="inline-block mt-1 px-2.5 py-0.5 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 rounded text-xs font-semibold">
                    {profile.role}
                  </span>
                </div>
              </div>

              <div className="mt-6 flex justify-end">
                <button 
                  onClick={() => setShowProfile(false)}
                  className="bg-slate-700 hover:bg-slate-600 text-slate-200 font-medium text-xs px-4 py-2 rounded-lg transition border border-slate-600"
                >
                  Cerrar Ventana
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
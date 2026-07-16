/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/immutability */
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
    title: String(x?.title ?? "(sin titulo)"),
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
      const saved = localStorage.getItem("user");
      const user = saved ? JSON.parse(saved) : null;
      setProfile({
        name: user?.name || "Usuario",
        email: user?.email || "Sin correo registrado",
        role: "Usuario",
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
    localStorage.removeItem("user");
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
    const progress = total ? Math.round((done / total) * 100) : 0;
    return { total, done, pending: total - done, progress };
  }, [tasks]);

  const statusPill = (status: Status) => {
    if (status === "Completada") return "bg-emerald-50 text-emerald-700 border-emerald-200";
    if (status === "En Progreso") return "bg-sky-50 text-sky-700 border-sky-200";
    return "bg-pink-50 text-pink-700 border-pink-200";
  };

  return (
    <div className="min-h-screen overflow-hidden bg-[#f7efff] text-slate-800 antialiased">
      <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet" />

      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-24 -top-24 h-96 w-96 rounded-full bg-pink-200/70 blur-3xl" />
        <div className="absolute right-0 top-0 h-[32rem] w-[32rem] rounded-full bg-violet-200/70 blur-3xl" />
        <div className="absolute bottom-0 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-sky-200/70 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        <header className="mb-6 overflow-hidden rounded-[2rem] bg-gradient-to-r from-pink-600 via-fuchsia-500 to-violet-500 text-white shadow-2xl shadow-pink-300/50">
          <div className="flex flex-col gap-6 p-6 sm:p-8 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.25em] text-white/75">TaskFlow PWA</p>
              <h1 className="mt-3 text-3xl font-extrabold leading-tight sm:text-4xl">Hola, {profile.name}</h1>
              <p className="mt-2 max-w-2xl text-sm font-medium text-white/85 sm:text-base">
                Organiza tus tareas con una vista clara, rapida y lista para trabajar online u offline.
              </p>
            </div>

            <div className="grid min-w-[260px] grid-cols-2 gap-3">
              <div className="rounded-2xl bg-white/15 p-4 backdrop-blur">
                <p className="text-xs font-semibold uppercase tracking-widest text-white/70">Avance</p>
                <p className="mt-1 text-3xl font-black">{stats.progress}%</p>
              </div>
              <div className="rounded-2xl bg-white/15 p-4 backdrop-blur">
                <p className="text-xs font-semibold uppercase tracking-widest text-white/70">Estado</p>
                <p className="mt-2 text-sm font-bold">{online ? "En linea" : "Offline"}</p>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t border-white/20 bg-white/10 px-6 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8">
            <div className="flex gap-2 text-sm font-semibold">
              <span className="rounded-full bg-white px-4 py-2 text-pink-600">Total {stats.total}</span>
              <span className="rounded-full bg-white/20 px-4 py-2 text-white">Hechas {stats.done}</span>
              <span className="rounded-full bg-white/20 px-4 py-2 text-white">Pendientes {stats.pending}</span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowProfile(true)}
                className="rounded-full bg-white px-4 py-2 text-sm font-bold text-violet-600 shadow-lg shadow-violet-900/10 transition hover:bg-violet-50"
              >
                Perfil
              </button>
              <button
                type="button"
                onClick={logout}
                className="rounded-full border border-white/30 px-4 py-2 text-sm font-bold text-white transition hover:bg-white/15"
              >
                Salir
              </button>
            </div>
          </div>
        </header>

        <main className="grid grid-cols-1 gap-6 lg:grid-cols-[360px_1fr]">
          <aside className="space-y-6">
            <section className="rounded-[1.6rem] bg-white/90 p-5 shadow-xl shadow-violet-200/50 ring-1 ring-white">
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-pink-500">Nueva tarea</p>
                  <h2 className="mt-1 text-xl font-black text-slate-900">Captura rapida</h2>
                </div>
                <span className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-pink-600 to-violet-500 text-2xl font-light text-white shadow-lg shadow-pink-200">+</span>
              </div>

              <form onSubmit={addTask} className="space-y-3">
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Que necesitas hacer?"
                  className="w-full rounded-2xl border border-pink-100 bg-pink-50/70 px-4 py-3 text-sm font-semibold text-black outline-none transition placeholder:text-slate-400 focus:border-pink-300 focus:bg-white focus:ring-4 focus:ring-pink-100"
                />
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Agrega una nota opcional"
                  rows={4}
                  className="w-full resize-none rounded-2xl border border-violet-100 bg-violet-50/70 px-4 py-3 text-sm text-black outline-none transition placeholder:text-slate-400 focus:border-violet-300 focus:bg-white focus:ring-4 focus:ring-violet-100"
                />
                <button
                  type="submit"
                  className="w-full rounded-2xl bg-gradient-to-r from-pink-600 to-violet-500 px-5 py-3 text-sm font-black text-white shadow-xl shadow-pink-200 transition hover:scale-[1.01] active:scale-[0.99]"
                >
                  Agregar tarea
                </button>
              </form>
            </section>

            <section className="grid grid-cols-3 gap-3">
              {[
                ["Total", stats.total, "from-pink-500 to-rose-400"],
                ["Activas", stats.pending, "from-violet-500 to-fuchsia-400"],
                ["Listas", stats.done, "from-cyan-500 to-sky-400"],
              ].map(([label, value, gradient]) => (
                <div key={String(label)} className={`rounded-2xl bg-gradient-to-br ${gradient} p-4 text-white shadow-lg shadow-violet-200/40`}>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-white/75">{label}</p>
                  <p className="mt-2 text-2xl font-black">{value}</p>
                </div>
              ))}
            </section>
          </aside>

          <section className="rounded-[1.8rem] bg-white/90 p-4 shadow-2xl shadow-violet-200/50 ring-1 ring-white sm:p-6">
            <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-violet-500">Mis pendientes</p>
                <h2 className="mt-1 text-2xl font-black text-slate-900">Lista de tareas</h2>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <label className="relative block min-w-[240px]">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold text-pink-400">S</span>
                  <input
                    type="text"
                    placeholder="Buscar tareas..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full rounded-2xl border border-slate-100 bg-slate-50 py-3 pl-10 pr-4 text-sm font-semibold text-pink-600 outline-none transition placeholder:text-slate-400 focus:border-pink-300 focus:bg-white focus:ring-4 focus:ring-pink-100"
                  />
                </label>

                <div className="flex rounded-2xl bg-slate-100 p-1">
                  {(["all", "active", "completed"] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setFilter(type)}
                      className={`rounded-xl px-3 py-2 text-xs font-black transition ${
                        filter === type
                          ? "bg-white text-pink-600 shadow"
                          : "text-slate-500 hover:text-slate-900"
                      }`}
                    >
                      {type === "all" ? "Todas" : type === "active" ? "Activas" : "Hechas"}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {loading ? (
              <div className="rounded-3xl border border-dashed border-violet-200 bg-violet-50/70 py-16 text-center text-sm font-bold text-violet-500">
                Cargando tus tareas...
              </div>
            ) : filtered.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-pink-200 bg-pink-50/70 py-16 text-center">
                <p className="text-lg font-black text-slate-800">No hay tareas aqui</p>
                <p className="mt-1 text-sm font-medium text-slate-500">Agrega una nueva tarea o cambia el filtro.</p>
              </div>
            ) : (
              <ul className="space-y-3">
                {filtered.map((t) => {
                  const isCompleted = t.status === "Completada";
                  return (
                    <li
                      key={t._id}
                      className={`group rounded-3xl border bg-white p-4 shadow-lg shadow-slate-200/70 transition hover:-translate-y-0.5 hover:shadow-xl ${
                        isCompleted ? "border-emerald-100 opacity-75" : "border-slate-100"
                      }`}
                    >
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0 flex-1">
                          {editingId === t._id ? (
                            <div className="space-y-2">
                              <input
                                value={editingTitle}
                                onChange={(e) => setEditingTitle(e.target.value)}
                                className="w-full rounded-2xl border border-pink-200 bg-pink-50 px-4 py-2 text-sm font-bold text-slate-900 outline-none focus:bg-white focus:ring-4 focus:ring-pink-100"
                                placeholder="Titulo"
                                autoFocus
                              />
                              <textarea
                                value={editingDescription}
                                onChange={(e) => setEditingDescription(e.target.value)}
                                className="w-full resize-none rounded-2xl border border-violet-200 bg-violet-50 px-4 py-2 text-sm text-slate-700 outline-none focus:bg-white focus:ring-4 focus:ring-violet-100"
                                placeholder="Descripcion"
                                rows={2}
                              />
                            </div>
                          ) : (
                            <>
                              <div className="flex flex-wrap items-center gap-2">
                                <h3
                                  className={`truncate text-lg font-black text-black ${
                                    isCompleted ? "line-through" : ""
                                  }`}
                                  onDoubleClick={() => startEdit(t)}
                                >
                                  {t.title}
                                </h3>
                                {(t.pending || isLocalId(t._id)) && (
                                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-black text-amber-700">
                                    Pendiente de sync
                                  </span>
                                )}
                              </div>
                              {t.description && (
                                <p className="mt-1 break-words text-sm font-medium text-black">
                                  {t.description}
                                </p>
                              )}
                            </>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                          <select
                            value={t.status}
                            onChange={(e) => handleStatusChange(t, e.target.value as Status)}
                            className={`rounded-2xl border px-3 py-2 text-xs font-black outline-none ${statusPill(t.status)}`}
                          >
                            <option value="Pendiente">Pendiente</option>
                            <option value="En Progreso">En Progreso</option>
                            <option value="Completada">Completada</option>
                          </select>

                          {editingId === t._id ? (
                            <button
                              type="button"
                              onClick={() => saveEdit(t._id)}
                              className="rounded-2xl bg-emerald-500 px-4 py-2 text-xs font-black text-white shadow-lg shadow-emerald-100 transition hover:bg-emerald-600"
                            >
                              Guardar
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => startEdit(t)}
                              className="rounded-2xl bg-violet-50 px-4 py-2 text-xs font-black text-pink-600 transition hover:bg-violet-100"
                            >
                              Editar
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => removeTask(t._id)}
                            className="rounded-2xl bg-rose-50 px-4 py-2 text-xs font-black text-pink-600 transition hover:bg-rose-100"
                          >
                            Eliminar
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </main>
      </div>

      {showProfile && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4 backdrop-blur-sm"
          onClick={() => setShowProfile(false)}
        >
          <div
            className="w-full max-w-sm overflow-hidden rounded-[1.7rem] bg-white shadow-2xl shadow-violet-300/50"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-gradient-to-r from-pink-600 via-fuchsia-500 to-violet-500 p-6 text-white">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/75">Perfil</p>
              <h2 className="mt-2 text-2xl font-black">{profile.name}</h2>
              <p className="mt-1 text-sm font-medium text-white/80">{profile.email}</p>
            </div>

            <div className="space-y-3 p-6">
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Rol</p>
                <p className="mt-1 font-black text-slate-900">{profile.role}</p>
              </div>
              <button
                type="button"
                onClick={() => setShowProfile(false)}
                className="w-full rounded-2xl bg-gradient-to-r from-pink-600 to-violet-500 px-4 py-3 text-sm font-black text-white"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

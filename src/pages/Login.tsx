import { useState } from "react";
import axios from "axios";
import { Link, useNavigate } from "react-router-dom";
import { api, setAuth } from "../api";
import logo from "../assets/Logoo.jpg";

export default function Login() {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const { data } = await api.post("/auth/login", { email, password });
      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));
      setAuth(data.token);
      nav("/dashboard");
    } catch (err: unknown) {
      const message = axios.isAxiosError<{ message?: string }>(err)
        ? err.response?.data?.message
        : undefined;
      setError(message || "Error al iniciar sesion");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="card">
        <div className="brand">
          <h2>To-Do App</h2>
          <img src={logo} alt="Logo" className="logo-img" />
          <p className="muted">Organiza tus tareas de manera eficiente</p>
        </div>
        <form className="form" onSubmit={onSubmit}>
          <label>Correo electronico</label>
          <input
            type="email"
            placeholder="Ingresa tu correo electronico"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <label>Contrasena</label>
          <div className="pass">
            <input
              type={show ? "text" : "password"}
              placeholder="********"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button
              type="button"
              className="ghost"
              onClick={() => setShow((s) => !s)}
              aria-label="Mostrar u ocultar contrasena"
            >
              {show ? "Ocultar" : "Mostrar"}
            </button>
          </div>

          {error && <div className="alert">{error}</div>}

          <button className="btn primary" disabled={loading}>
            {loading ? "Iniciando sesion..." : "Iniciar sesion"}
          </button>
        </form>
        <div className="footer-links">
          <span className="muted">No tienes una cuenta?</span>
          <Link to="/register" className="link">Registrate aqui</Link>
        </div>
      </div>
    </div>
  );
}

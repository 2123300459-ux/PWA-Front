import { useState } from "react";
import axios from "axios";
import { Link, useNavigate } from "react-router-dom";
import { api, setAuth } from "../api";
import logo from "../assets/Logoo.jpg";

export default function Register() {
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function getRegisterError(err: unknown) {
    if (!axios.isAxiosError<{ message?: string }>(err)) {
      return "Error al registrarte. Intentalo de nuevo.";
    }

    if (!err.response) {
      return "No se pudo conectar con el backend. Revisa VITE_API_URL en Vercel.";
    }

    return err.response.data?.message || "Error al registrarte. Intentalo de nuevo.";
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const { data } = await api.post("/auth/register", { name, email, password });
      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));
      setAuth(data.token);
      nav("/dashboard");
    } catch (err: unknown) {
      setError(getRegisterError(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="card">
        <div className="brand">
          <img src={logo} alt="Logo" className="logo-img" />
          <h2>Crear Cuenta</h2>
          <p className="muted">Unete a To-Do App y organiza tus tareas de manera eficiente</p>
        </div>
        <form className="form" onSubmit={onSubmit}>
          <label>Nombre completo</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ingresa tu nombre"
            required
          />

          <label>Correo electronico</label>
          <input
            type="email"
            placeholder="Ingresa tu correo electronico"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <label>Contrasena</label>
          <input
            type="password"
            placeholder="Ingresa tu contrasena"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          <button type="submit" disabled={loading}>
            {loading ? "Registrando..." : "Registrarse"}
          </button>

          <p className="muted">Ya tienes una cuenta? <Link to="/">Inicia sesion</Link></p>
          {error && <p className="error">{error}</p>}
        </form>
      </div>
    </div>
  );
}

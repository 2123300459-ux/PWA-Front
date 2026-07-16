import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { Link, useNavigate } from "react-router-dom";
import { api, setAuth } from "../api";
import logo from "../assets/Logoo.jpg";

type GoogleCredentialResponse = {
  credential?: string;
};

type GoogleButtonConfig = {
  theme: "outline";
  size: "large";
  width: string;
  text: "signin_with";
  shape: "pill";
};

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: GoogleCredentialResponse) => void;
          }) => void;
          renderButton: (element: HTMLElement, config: GoogleButtonConfig) => void;
        };
      };
    };
  }
}

export default function Login() {
  const nav = useNavigate();
  const googleButtonRef = useRef<HTMLDivElement | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState("");
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

  function getLoginError(err: unknown) {
    if (!axios.isAxiosError<{ message?: string }>(err)) {
      return "Error al iniciar sesion";
    }

    if (!err.response) {
      return "No se pudo conectar con el backend. Revisa VITE_API_URL en Vercel.";
    }

    return err.response.data?.message || "Error al iniciar sesion";
  }

  const handleGoogleCredential = useCallback(async (response: GoogleCredentialResponse) => {
    if (!response.credential) {
      setError("Google no devolvio una credencial valida.");
      return;
    }

    setError("");
    setGoogleLoading(true);

    try {
      const { data } = await api.post("/auth/google", { credential: response.credential });
      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));
      setAuth(data.token);
      nav("/dashboard");
    } catch (err: unknown) {
      setError(getLoginError(err));
    } finally {
      setGoogleLoading(false);
    }
  }, [nav]);

  useEffect(() => {
    if (!googleClientId || !googleButtonRef.current) return;

    const renderGoogleButton = () => {
      if (!window.google || !googleButtonRef.current) return;
      googleButtonRef.current.innerHTML = "";
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: handleGoogleCredential,
      });
      window.google.accounts.id.renderButton(googleButtonRef.current, {
        theme: "outline",
        size: "large",
        width: "100%",
        text: "signin_with",
        shape: "pill",
      });
    };

    if (window.google) {
      renderGoogleButton();
      return;
    }

    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[src="https://accounts.google.com/gsi/client"]'
    );

    if (existingScript) {
      existingScript.addEventListener("load", renderGoogleButton);
      return () => existingScript.removeEventListener("load", renderGoogleButton);
    }

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = renderGoogleButton;
    document.body.appendChild(script);
  }, [googleClientId, handleGoogleCredential]);

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
      setError(getLoginError(err));
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

        <div className="auth-divider">
          <span>o</span>
        </div>

        {googleClientId ? (
          <div className="google-login-wrap">
            <div ref={googleButtonRef} />
            {googleLoading && <p className="muted">Validando cuenta de Google...</p>}
          </div>
        ) : (
          <div className="alert">Configura VITE_GOOGLE_CLIENT_ID para activar Google.</div>
        )}

        <div className="footer-links">
          <span className="muted">No tienes una cuenta?</span>
          <Link to="/register" className="link">Registrate aqui</Link>
        </div>
      </div>
    </div>
  );
}

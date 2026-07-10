import axios from "axios";

export const api = axios.create({
    baseURL: import.meta.env.VITE_API_URL || "/api",
});

export function setAuth(token: string | null){
    if(token) api.defaults.headers.common["Authorization"] = `Bearer ${token}`;
    else delete api.defaults.headers.common["Authorization"];
}

setAuth(localStorage.getItem("token"));

api.interceptors.response.use(
    (r)=>r,
    (err)=>{
        const requestUrl = String(err.config?.url || "");
        const isAuthRequest = requestUrl.includes("/auth/login") || requestUrl.includes("/auth/register");
        const isPublicPage = window.location.pathname === "/" || window.location.pathname === "/register";

        if(err.response?.status === 401 && !isAuthRequest && !isPublicPage){
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            setAuth(null);
            window.location.href = '/';
        }
        return Promise.reject(err);
    }
)

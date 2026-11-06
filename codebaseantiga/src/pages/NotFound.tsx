import { useLocation } from "react-router-dom";
import { useEffect } from "react";
import logoIconBlue from "@/assets/logo-icon-blue.png";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-center">
        <img src={logoIconBlue} alt="ChicoChat+" className="w-16 h-16 mx-auto mb-6 opacity-30" />
        <h1 className="mb-2 text-6xl font-bold font-['Velocity'] text-primary">404</h1>
        <p className="mb-6 text-lg text-muted-foreground">Página não encontrada</p>
        <a href="/" className="text-primary font-medium hover:underline">
          Voltar ao início
        </a>
      </div>
    </div>
  );
};

export default NotFound;

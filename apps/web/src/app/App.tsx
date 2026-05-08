import { RouterProvider } from "react-router";
import { AuthProvider } from "../api/auth";
import { router } from "./routes";

export default function App() {
  return (
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  );
}

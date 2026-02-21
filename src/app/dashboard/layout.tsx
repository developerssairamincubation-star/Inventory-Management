import ProtectedRoute from "@/components/protected-route";
import Sidebar from "@/components/sidebar";
import Navbar from "@/components/navbar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ProtectedRoute>
      <div className="flex h-screen overflow-hidden bg-slate-50">
        <Sidebar />
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <Navbar />
          <main className="flex-1 min-h-0 overflow-hidden">{children}</main>
        </div>
      </div>
    </ProtectedRoute>
  );
}

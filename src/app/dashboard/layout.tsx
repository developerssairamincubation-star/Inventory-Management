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
      <div className="flex" style={{ height: '100vh', overflow: 'hidden', background: 'var(--bg)' }}>
        <Sidebar />
        <div className="flex flex-col min-w-0" style={{ flex: 1, height: '100vh', overflow: 'hidden', borderLeft: '1px solid var(--border)' }}>
          <Navbar />
          <main className="p-5" style={{ flex: 1, overflowY: 'auto', background: 'var(--surface)' }}>
            {children}
          </main>
        </div>
      </div>
    </ProtectedRoute>
  );
}

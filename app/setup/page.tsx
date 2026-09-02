import { AdminSetupWorkspace } from "@/components/AdminSetupWorkspace";
import { AuthSessionBootstrap } from "@/components/AuthSessionBootstrap";

export default function SetupPage(): React.JSX.Element {
  return (
    <main>
      <AuthSessionBootstrap />
      <AdminSetupWorkspace />
    </main>
  );
}

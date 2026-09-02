import { AppWorkspace } from "@/components/AppWorkspace";
import { AuthSessionBootstrap } from "@/components/AuthSessionBootstrap";

export default function Home(): React.JSX.Element {
  return (
    <main>
      <AuthSessionBootstrap />
      <AppWorkspace />
    </main>
  );
}

import { copy } from "../i18n/messages";

export default function Home() {
  return (
    <main>
      <h1>{copy.app.homeTitle}</h1>
      <p>{copy.app.offlineShell}</p>
      <p aria-label="offline queue status">{copy.app.offlineReady}</p>
    </main>
  );
}

import { Link } from "react-router-dom";
import { copy } from "../i18n/messages";

export default function Home() {
  return (
    <main>
      <h1>{copy.app.homeTitle}</h1>
      <p>{copy.app.offlineShell}</p>
      <p aria-label="offline queue status">{copy.app.offlineReady}</p>
      <nav style={{ marginTop: "2rem" }}>
        <ul>
          <li>
            <Link to="/shifts">{copy.shiftView.title}</Link>
          </li>
        </ul>
      </nav>
    </main>
  );
}

import { HashRouter, Link, Route, Routes } from 'react-router-dom';
import { AppProvider } from './lib/store';
import { Shell } from './components/Shell';
import { Empty, Toasts } from './components/ui';
import { Landing } from './pages/Landing';
import { SignIn } from './pages/SignIn';
import { Dashboard } from './pages/Dashboard';
import { Challenges } from './pages/Challenges';
import { ChallengeDetail } from './pages/ChallengeDetail';
import { Report } from './pages/Report';
import { Intelligence } from './pages/Intelligence';
import { Playbooks } from './pages/Playbooks';
import { Team } from './pages/Team';
import { Routing } from './pages/Routing';
import { Analytics } from './pages/Analytics';
import { Inbox } from './pages/Inbox';
import { SettingsPage } from './pages/Settings';
import { PublicWorkflow, WorkflowPage } from './pages/Workflow';
import { Register } from './pages/Register';

function NotFound() {
  return (
    <div className="page">
      <Empty icon="map" title="This page doesn’t exist" text="The link may be out of date." action={<Link to="/app" className="btn btn-dark btn-sm">Go to dashboard</Link>} />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <HashRouter>
        <Routes>
          <Route path="/" element={<SignIn />} />
          <Route path="/signin" element={<SignIn />} />
          <Route path="/home" element={<Landing />} />
          <Route path="/workflow" element={<PublicWorkflow />} />
          <Route path="/register" element={<Register />} />
          <Route path="/app" element={<Shell />}>
            <Route index element={<Dashboard />} />
            <Route path="challenges" element={<Challenges />} />
            <Route path="challenges/:id" element={<ChallengeDetail />} />
            <Route path="report" element={<Report />} />
            <Route path="workflow" element={<WorkflowPage />} />
            <Route path="intelligence" element={<Intelligence />} />
            <Route path="playbooks" element={<Playbooks />} />
            <Route path="team" element={<Team />} />
            <Route path="routing" element={<Routing />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="inbox" element={<Inbox />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<NotFound />} />
          </Route>
          <Route path="*" element={<SignIn />} />
        </Routes>
        <Toasts />
      </HashRouter>
    </AppProvider>
  );
}

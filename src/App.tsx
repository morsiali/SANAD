import { useState, type ReactNode } from "react";

type IconName =
  | "home"
  | "calendar"
  | "case"
  | "heart"
  | "message"
  | "bell"
  | "chevron"
  | "check"
  | "clock"
  | "car"
  | "pill"
  | "user"
  | "sparkles"
  | "shield"
  | "plus"
  | "arrow"
  | "phone"
  | "close"
  | "utensils"
  | "house"
  | "file";

const paths: Record<IconName, ReactNode> = {
  home: <><path d="m3 10 9-7 9 7"/><path d="M5 9v11h14V9"/><path d="M9 20v-6h6v6"/></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></>,
  case: <><path d="M8 6V4h8v2"/><rect x="3" y="6" width="18" height="15" rx="2"/><path d="M3 12h18M10 12v2h4v-2"/></>,
  heart: <><path d="M12 21S4 16.5 4 9.5A4.5 4.5 0 0 1 12 6a4.5 4.5 0 0 1 8 3.5C20 16.5 12 21 12 21Z"/><path d="M8 12h2l1-2 2 4 1-2h2"/></>,
  message: <><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"/><path d="M8 9h8M8 13h5"/></>,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></>,
  chevron: <path d="m9 18 6-6-6-6"/>,
  check: <path d="m5 12 4 4L19 6"/>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  car: <><path d="m5 16-2-1v-4l2-1 2-4h10l2 4 2 1v4l-2 1"/><path d="M5 10h14M7 16v2M17 16v2"/><circle cx="7" cy="13" r="1"/><circle cx="17" cy="13" r="1"/></>,
  pill: <><path d="M10.5 5.5 5.4 10.6a4 4 0 0 0 5.7 5.7l5.1-5.1a4 4 0 0 0-5.7-5.7Z"/><path d="m8 8 5.7 5.7"/></>,
  user: <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>,
  sparkles: <><path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2Z"/><path d="m19 14 .7 2.3L22 17l-2.3.7L19 20l-.7-2.3L16 17l2.3-.7Z"/><path d="m5 14 .7 1.3L7 16l-1.3.7L5 18l-.7-1.3L3 16l1.3-.7Z"/></>,
  shield: <><path d="M12 22s8-3 8-10V5l-8-3-8 3v7c0 7 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/></>,
  plus: <path d="M12 5v14M5 12h14"/>,
  arrow: <path d="m9 18 6-6-6-6"/>,
  phone: <path d="M6.6 3H4a1 1 0 0 0-1 1c0 9.4 7.6 17 17 17a1 1 0 0 0 1-1v-2.6a1 1 0 0 0-.7-1l-3.2-.8a1 1 0 0 0-1 .3l-.7.9a15 15 0 0 1-8.2-8.2l.9-.7a1 1 0 0 0 .3-1l-.8-3.2a1 1 0 0 0-1-.7Z"/>,
  close: <path d="m6 6 12 12M18 6 6 18"/>,
  utensils: <><path d="M6 3v7M3 3v5a3 3 0 0 0 6 0V3M6 10v11M15 3v18M15 3c4 2 5 7 0 10"/></>,
  house: <><path d="m3 10 9-7 9 7v10H3Z"/><path d="M9 20v-6h6v6"/></>,
  file: <><path d="M6 2h8l4 4v16H6Z"/><path d="M14 2v5h5M9 12h6M9 16h6"/></>,
};

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return <svg aria-hidden="true" className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function Button({ children, className = "", onClick, ariaLabel }: { children: ReactNode; className?: string; onClick?: () => void; ariaLabel?: string }) {
  return <button type="button" className={className} onClick={onClick} aria-label={ariaLabel}>{children}</button>;
}

const en = {
  nav: ["Overview", "Today", "Cases", "Life map", "Messages"],
  hello: "Good morning, Mariam",
  subtitle: "Here’s how Fatima is doing today.",
};

const ar = {
  nav: ["نظرة عامة", "اليوم", "الحالات", "خريطة الحياة", "الرسائل"],
  hello: "صباح الخير، مريم",
  subtitle: "إليكِ أحوال فاطمة اليوم.",
};

const navIcons: IconName[] = ["home", "calendar", "case", "heart", "message"];

export default function App() {
  const [active, setActive] = useState(0);
  const [arabic, setArabic] = useState(false);
  const [transportApproved, setTransportApproved] = useState(false);
  const [medicationDone, setMedicationDone] = useState(true);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [toast, setToast] = useState("");
  const copy = arabic ? ar : en;

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2800);
  }

  function approveTransport() {
    setTransportApproved(true);
    showToast("Transport approved. Fatima and the driver have been notified.");
  }

  return (
    <div className="app-shell" dir={arabic ? "rtl" : "ltr"}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><span>S</span></div>
          <div><strong>SANAD</strong><small>Life & care, connected</small></div>
        </div>

        <div className="person-card">
          <div className="avatar avatar-fatima">F</div>
          <div><span>Caring for</span><strong>Fatima Al Noor</strong><small>Age 72 · At home</small></div>
          <span className="online-dot" aria-label="Online" />
        </div>

        <nav aria-label="Main navigation">
          <p className="nav-label">CARE CENTER</p>
          {copy.nav.map((label, index) => (
            <Button key={label} className={`nav-item ${active === index ? "active" : ""}`} onClick={() => setActive(index)}>
              <Icon name={navIcons[index]} /><span>{label}</span>
              {index === 2 && !transportApproved && <em>1</em>}
            </Button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="privacy-note"><Icon name="shield" size={18}/><span><strong>Your data is protected</strong><small>Private and secure</small></span></div>
          <Button className="help-button" onClick={() => setHelpOpen(true)}><Icon name="phone"/><span>Get help</span></Button>
          <span className="sandbox-label">DEMONSTRATION ENVIRONMENT</span>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="mobile-brand"><div className="brand-mark"><span>S</span></div><strong>SANAD</strong></div>
          <div className="top-actions">
            <Button className="language-button" onClick={() => setArabic(!arabic)}><span>{arabic ? "EN" : "ع"}</span>{arabic ? "English" : "العربية"}</Button>
            <Button className="icon-button notification-button" ariaLabel="Notifications" onClick={() => setNotificationsOpen(!notificationsOpen)}>
              <Icon name="bell"/><span className="notification-dot"/>
            </Button>
            <div className="profile-wrap">
              <Button className="profile-button" onClick={() => setProfileOpen(!profileOpen)}>
                <div className="avatar avatar-mariam">M</div>
                <span><strong>Mariam</strong><small>Family member</small></span>
                <Icon name="chevron" size={16}/>
              </Button>
              {profileOpen && <div className="dropdown profile-menu">
                <strong>Mariam Al Noor</strong><span>Primary family contact</span>
                <Button onClick={() => { setProfileOpen(false); showToast("Profile preferences saved."); }}>Manage preferences</Button>
              </div>}
            </div>
          </div>
          {notificationsOpen && <div className="dropdown notifications">
            <div className="dropdown-head"><strong>Notifications</strong><Button ariaLabel="Close notifications" onClick={() => setNotificationsOpen(false)}><Icon name="close" size={18}/></Button></div>
            <div className="notification-row new"><span className="mini-icon amber"><Icon name="car" size={17}/></span><div><strong>Transport needs approval</strong><small>For tomorrow’s cardiology visit · 12 min ago</small></div></div>
            <div className="notification-row"><span className="mini-icon green"><Icon name="check" size={17}/></span><div><strong>Morning medication confirmed</strong><small>Confirmed by Fatima · 8:08 AM</small></div></div>
          </div>}
        </header>

        <div className="content">
          {active === 0 && <Overview
            copy={copy}
            approved={transportApproved}
            medicationDone={medicationDone}
            setMedicationDone={setMedicationDone}
            approve={approveTransport}
            goTo={setActive}
            notify={showToast}
          />}
          {active === 1 && <Today medicationDone={medicationDone} setMedicationDone={setMedicationDone} notify={showToast}/>}
          {active === 2 && <Cases approved={transportApproved} approve={approveTransport}/>}
          {active === 3 && <LifeMap/>}
          {active === 4 && <Messages notify={showToast}/>}
        </div>
      </main>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        {copy.nav.slice(0, 5).map((label, index) => (
          <Button key={label} className={active === index ? "active" : ""} onClick={() => setActive(index)}><Icon name={navIcons[index]}/><span>{label}</span></Button>
        ))}
      </nav>

      {helpOpen && <div className="modal-backdrop" role="presentation" onMouseDown={() => setHelpOpen(false)}>
        <section className="modal" role="dialog" aria-modal="true" aria-labelledby="help-title" onMouseDown={(event) => event.stopPropagation()}>
          <Button className="modal-close" ariaLabel="Close" onClick={() => setHelpOpen(false)}><Icon name="close"/></Button>
          <span className="modal-symbol"><Icon name="phone" size={26}/></span>
          <h2 id="help-title">How can we help?</h2>
          <p>A SANAD care coordinator is available to support Fatima and your family.</p>
          <Button className="primary-button full" onClick={() => { setHelpOpen(false); showToast("Call requested. A care coordinator will contact you shortly."); }}><Icon name="phone"/>Request a call</Button>
          <Button className="secondary-button full" onClick={() => { setHelpOpen(false); setActive(4); }}>Send a secure message</Button>
        </section>
      </div>}
      {toast && <div className="toast" role="status"><span><Icon name="check" size={17}/></span>{toast}</div>}
    </div>
  );
}

function Overview({ copy, approved, medicationDone, setMedicationDone, approve, goTo, notify }: {
  copy: typeof en; approved: boolean; medicationDone: boolean; setMedicationDone: (value: boolean) => void;
  approve: () => void; goTo: (index: number) => void; notify: (message: string) => void;
}) {
  return <>
    <section className="welcome">
      <div><p className="eyebrow">MONDAY, 16 JUNE</p><h1>{copy.hello}</h1><p>{copy.subtitle}</p></div>
      <div className="wellbeing"><span className="pulse"><i/></span><div><small>OVERALL WELLBEING</small><strong>Stable</strong></div><span>All routines normal</span></div>
    </section>

    {!approved ? <section className="attention-card">
      <div className="attention-icon"><Icon name="car" size={24}/></div>
      <div className="attention-copy">
        <div><span className="status-pill amber-pill">ACTION NEEDED</span><span className="case-id">CASE #SN-2048</span></div>
        <h2>Transport needed for tomorrow’s appointment</h2>
        <p>Fatima has a cardiology appointment at 10:30 AM, but no transport is booked yet.</p>
        <div className="ai-reason"><Icon name="sparkles" size={18}/><span><strong>Why Sanad recommends this</strong>Fatima prefers assisted travel and the clinic is 18 minutes away.</span></div>
      </div>
      <div className="attention-action">
        <div className="provider-line"><span><Icon name="car" size={18}/></span><div><small>RECOMMENDED</small><strong>CareRide Assisted</strong><em>4.9 rating · AED 45</em></div></div>
        <Button className="primary-button" onClick={approve}>Approve & book <Icon name="arrow" size={17}/></Button>
        <Button className="text-button" onClick={() => goTo(2)}>Review case details</Button>
      </div>
    </section> : <section className="resolved-banner"><span><Icon name="check"/></span><div><strong>Transport is booked</strong><p>CareRide Assisted will collect Fatima tomorrow at 9:45 AM.</p></div><Button onClick={() => goTo(2)}>View case <Icon name="arrow" size={16}/></Button></section>}

    <section className="metrics-grid">
      <Metric icon="heart" tone="green" label="WELLBEING" value="Stable" detail="No changes detected" />
      <Metric icon="case" tone="amber" label="OPEN CASES" value={approved ? "0" : "1"} detail={approved ? "All resolved" : "Needs your approval"} alert={!approved}/>
      <Metric icon="pill" tone="blue" label="MEDICATION" value={medicationDone ? "On track" : "Due now"} detail={medicationDone ? "2 of 2 taken today" : "Morning dose unconfirmed"}/>
      <Metric icon="calendar" tone="purple" label="NEXT APPOINTMENT" value="Tomorrow" detail="Cardiology · 10:30 AM"/>
    </section>

    <div className="dashboard-grid">
      <section className="panel today-panel">
        <div className="panel-title"><div><h2>Fatima’s day</h2><p>Monday, 16 June</p></div><Button onClick={() => goTo(1)}>View full day <Icon name="arrow" size={16}/></Button></div>
        <div className="timeline">
          <TimelineRow time="8:00" period="AM" icon="pill" tone="blue" title="Morning medication" detail="Blood pressure · 1 tablet" done={medicationDone} onClick={() => setMedicationDone(!medicationDone)}/>
          <TimelineRow time="9:00" period="AM" icon="utensils" tone="orange" title="Breakfast" detail="Meal delivered by Aisha" done/>
          <TimelineRow time="10:00" period="AM" icon="heart" tone="green" title="Morning walk" detail="20 minutes · With caregiver" current/>
          <TimelineRow time="1:00" period="PM" icon="utensils" tone="orange" title="Lunch" detail="Prepared meal at home"/>
          <TimelineRow time="6:00" period="PM" icon="phone" tone="purple" title="Call with Mariam" detail="Regular evening check-in"/>
        </div>
      </section>

      <div className="right-stack">
        <section className="panel sanad-card">
          <div className="panel-title"><div className="title-with-icon"><span className="sanad-icon"><Icon name="sparkles" size={19}/></span><div><h2>Sanad is looking out</h2><p>Latest coordination activity</p></div></div></div>
          <div className="activity-list">
            <Activity icon="check" tone="green" title="Medication confirmed" detail="Fatima confirmed her morning dose" time="8:08 AM"/>
            <Activity icon="user" tone="blue" title="Caregiver arrived" detail="Aisha checked in at Fatima’s home" time="8:52 AM"/>
            <Activity icon="car" tone="amber" title="Transport gap detected" detail="Case SN-2048 created automatically" time="9:14 AM"/>
          </div>
          <Button className="panel-footer-button" onClick={() => goTo(2)}>See all activity <Icon name="arrow" size={16}/></Button>
        </section>

        <section className="panel connected-care">
          <div className="panel-title"><div><h2>Connected care circle</h2><p>Everyone supporting Fatima</p></div></div>
          <div className="care-people">
            <Person initials="MA" tone="rose" name="Mariam" role="You · Family"/>
            <Person initials="AI" tone="teal" name="Aisha" role="Caregiver"/>
            <Person initials="DK" tone="blue" name="Dr. Kareem" role="Cardiologist"/>
          </div>
          <Button className="outline-button" onClick={() => notify("Care circle is up to date. All three members are connected.")}><Icon name="plus" size={17}/> Manage care circle</Button>
        </section>
      </div>
    </div>
  </>;
}

function Metric({ icon, tone, label, value, detail, alert }: { icon: IconName; tone: string; label: string; value: string; detail: string; alert?: boolean }) {
  return <article className="metric-card"><span className={`metric-icon ${tone}`}><Icon name={icon}/></span><div><small>{label}</small><strong>{value}</strong><p className={alert ? "alert-text" : ""}>{detail}</p></div>{alert && <span className="alert-dot"/>}</article>;
}

function TimelineRow({ time, period, icon, tone, title, detail, done, current, onClick }: { time: string; period: string; icon: IconName; tone: string; title: string; detail: string; done?: boolean; current?: boolean; onClick?: () => void }) {
  return <div className={`timeline-row ${current ? "current" : ""}`}>
    <div className="timeline-time"><strong>{time}</strong><span>{period}</span></div>
    <span className={`timeline-icon ${tone}`}><Icon name={icon} size={18}/></span>
    <div className="timeline-copy"><strong>{title}</strong><span>{detail}</span></div>
    {done ? <Button className="done-button" ariaLabel={`Mark ${title} incomplete`} onClick={onClick}><Icon name="check" size={15}/> Done</Button> : current ? <span className="now-pill">NOW</span> : <span className="upcoming">Upcoming</span>}
  </div>;
}

function Activity({ icon, tone, title, detail, time }: { icon: IconName; tone: string; title: string; detail: string; time: string }) {
  return <div className="activity"><span className={`activity-icon ${tone}`}><Icon name={icon} size={16}/></span><div><strong>{title}</strong><p>{detail}</p></div><time>{time}</time></div>;
}

function Person({ initials, tone, name, role }: { initials: string; tone: string; name: string; role: string }) {
  return <div className="person"><span className={`person-avatar ${tone}`}>{initials}</span><strong>{name}</strong><small>{role}</small></div>;
}

function Today({ medicationDone, setMedicationDone, notify }: { medicationDone: boolean; setMedicationDone: (value: boolean) => void; notify: (message: string) => void }) {
  return <section className="page-section">
    <div className="page-heading"><p className="eyebrow">MONDAY, 16 JUNE</p><h1>Fatima’s day</h1><p>A simple view of today’s care, meals, and connections.</p></div>
    <div className="simple-callout"><div><Icon name="heart" size={26}/></div><span><strong>Everything looks good today</strong><p>Fatima is on schedule and Aisha is with her now.</p></span></div>
    <section className="panel spacious">
      <div className="timeline large">
        <TimelineRow time="8:00" period="AM" icon="pill" tone="blue" title="Morning medication" detail="Blood pressure · 1 tablet" done={medicationDone} onClick={() => setMedicationDone(!medicationDone)}/>
        <TimelineRow time="9:00" period="AM" icon="utensils" tone="orange" title="Breakfast" detail="Meal delivered by Aisha" done/>
        <TimelineRow time="10:00" period="AM" icon="heart" tone="green" title="Morning walk" detail="20 minutes · With caregiver" current/>
        <TimelineRow time="1:00" period="PM" icon="utensils" tone="orange" title="Lunch" detail="Prepared meal at home"/>
        <TimelineRow time="6:00" period="PM" icon="phone" tone="purple" title="Call with Mariam" detail="Regular evening check-in"/>
      </div>
    </section>
    <Button className="primary-button floating-action" onClick={() => notify("Aisha has been notified that you are checking in.")}><Icon name="message"/> Check in with Aisha</Button>
  </section>;
}

function Cases({ approved, approve }: { approved: boolean; approve: () => void }) {
  return <section className="page-section">
    <div className="page-heading"><p className="eyebrow">CARE COORDINATION</p><h1>Cases</h1><p>Every concern has an owner, a next step, and a clear outcome.</p></div>
    <div className="case-stats"><div><strong>{approved ? 0 : 1}</strong><span>Open</span></div><div><strong>0</strong><span>Escalated</span></div><div><strong>{approved ? 1 : 0}</strong><span>Resolved this week</span></div></div>
    <article className="case-detail">
      <div className="case-top"><span className={`status-pill ${approved ? "green-pill" : "amber-pill"}`}>{approved ? "BOOKED" : "WAITING FOR APPROVAL"}</span><span className="case-id">CASE #SN-2048</span><time>Created 14 minutes ago</time></div>
      <div className="case-main"><span className="case-main-icon"><Icon name="car" size={25}/></span><div><h2>Transport for cardiology appointment</h2><p>Fatima needs assisted transport to Al Noor Cardiology Center tomorrow morning.</p></div></div>
      <div className="workflow">
        {["Detected", "Analyzed", "Assigned", approved ? "Booked" : "Approval"].map((step, index) => <div className={`workflow-step ${index < (approved ? 5 : 4) ? "complete" : "active"}`} key={step}><span>{index < (approved ? 5 : 4) ? <Icon name="check" size={14}/> : index + 1}</span><strong>{step}</strong></div>)}
      </div>
      <div className="case-columns">
        <div><small>RESPONSIBLE</small><strong>CareRide Assisted</strong><p>Approved transport partner</p></div>
        <div><small>NEXT STEP</small><strong>{approved ? "Driver assignment" : "Mariam’s approval"}</strong><p>{approved ? "Expected by 6:00 PM" : "Booking held for 45 minutes"}</p></div>
        <div><small>EXPECTED RESOLUTION</small><strong>Tomorrow, 11:45 AM</strong><p>After Fatima arrives home</p></div>
      </div>
      {!approved && <div className="case-action"><div><strong>AED 45</strong><span>No payment taken until approved</span></div><Button className="primary-button" onClick={approve}>Approve & book transport <Icon name="arrow" size={17}/></Button></div>}
    </article>
  </section>;
}

function LifeMap() {
  const areas: [IconName, string, string, string][] = [
    ["heart", "Health", "Stable", "green"], ["pill", "Medication", "On track", "green"],
    ["calendar", "Appointments", "1 upcoming", "blue"], ["user", "Care circle", "3 connected", "green"],
    ["car", "Mobility", "Needs attention", "amber"], ["utensils", "Nutrition", "Healthy", "green"],
    ["house", "Home", "All good", "green"], ["file", "Documents", "Up to date", "blue"],
  ];
  return <section className="page-section">
    <div className="page-heading"><p className="eyebrow">WHOLE-PERSON VIEW</p><h1>Fatima’s life map</h1><p>One connected picture of the people, routines, and services supporting her.</p></div>
    <div className="life-summary"><div className="life-center"><div className="avatar avatar-fatima">F</div><strong>Fatima</strong><span>Living independently at home</span></div><div className="life-score"><strong>7 of 8</strong><span>areas are healthy</span></div></div>
    <div className="life-grid">{areas.map(([icon, name, status, tone]) => <article className="life-card" key={name}><span className={`metric-icon ${tone}`}><Icon name={icon}/></span><div><h2>{name}</h2><p className={tone === "amber" ? "alert-text" : ""}>{status}</p></div><Icon name="chevron" size={17}/></article>)}</div>
  </section>;
}

function Messages({ notify }: { notify: (message: string) => void }) {
  const [text, setText] = useState("");
  const [sent, setSent] = useState<string[]>([]);
  function send() {
    if (!text.trim()) return;
    setSent([...sent, text.trim()]);
    setText("");
    notify("Your secure message was sent to Aisha.");
  }
  return <section className="page-section">
    <div className="page-heading"><p className="eyebrow">SECURE COMMUNICATION</p><h1>Messages</h1><p>Care conversations stay connected to Fatima’s support plan.</p></div>
    <section className="message-layout panel">
      <aside className="conversation-list"><p>CARE CIRCLE</p><div className="conversation active"><span className="person-avatar teal">AI</span><div><strong>Aisha Ibrahim</strong><small>Fatima’s caregiver</small></div><span className="online-dot"/></div></aside>
      <div className="chat">
        <div className="chat-head"><span className="person-avatar teal">AI</span><div><strong>Aisha Ibrahim</strong><small>At Fatima’s home now</small></div></div>
        <div className="chat-body">
          <time>TODAY</time>
          <div className="bubble incoming">Good morning Mariam. Fatima had breakfast and took her medication. We’re getting ready for our walk.<small>9:12 AM</small></div>
          <div className="bubble outgoing">Thank you, Aisha. Please let me know how she feels after the walk.<small>9:15 AM</small></div>
          {sent.map((message, index) => <div className="bubble outgoing" key={`${message}-${index}`}>{message}<small>Just now</small></div>)}
        </div>
        <div className="composer"><input aria-label="Message Aisha" value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => event.key === "Enter" && send()} placeholder="Write a secure message…"/><Button className="primary-button" onClick={send}>Send <Icon name="arrow" size={16}/></Button></div>
      </div>
    </section>
  </section>;
}

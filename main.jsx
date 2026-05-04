import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

const KEY = "redemption_pos_compact_v1";
const DEFAULTS = { businessName: "Bottle & Can Redemption Center", depositRate: 0.05, cashierName: "Preview User", managerPin: "1234" };
const EMPTY_CUSTOMER = { name: "", phone: "", email: "", notes: "" };
const PRESETS = [["Single", 1, true], ["6 Pack", 6], ["12 Pack", 12], ["18 Pack", 18], ["24 Pack", 24], ["30 Pack", 30], ["Case 36", 36], ["Bag 100", 100]];
const uid = () => `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const money = (n) => `$${Number(n || 0).toFixed(2)}`;
const day = (d = new Date()) => new Date(d).toISOString().slice(0, 10);
const text = (...v) => v.join(" ").toLowerCase();

function fresh() { return { settings: DEFAULTS, customers: [], txs: [], shifts: [] }; }
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "null");
    return s ? { settings: { ...DEFAULTS, ...s.settings }, customers: s.customers || [], txs: s.txs || [], shifts: s.shifts || [] } : fresh();
  } catch { return fresh(); }
}
function stats(customers, txs) {
  const out = Object.fromEntries(customers.map(c => [c.id, { tx: 0, units: 0, total: 0, cash: 0, credit: 0, last: null }]));
  txs.forEach(t => {
    if (!t.customerId || t.voidedAt) return;
    out[t.customerId] ||= { tx: 0, units: 0, total: 0, cash: 0, credit: 0, last: null };
    const s = out[t.customerId], amt = Number(t.totalAmount || 0);
    s.tx++; s.units += Number(t.totalUnits || 0); s.total += amt;
    t.paymentType === "credit" ? s.credit += amt : s.cash += amt;
    if (!s.last || new Date(t.createdAt) > new Date(s.last)) s.last = t.createdAt;
  });
  return out;
}
function runTests() {
  console.assert(money(1.5) === "$1.50", "money formats");
  console.assert(day("2026-05-03T12:00:00") === "2026-05-03", "date formats");
  console.assert(PRESETS.some(p => p[2]), "single popup exists");
  console.assert(text("Lions", "555").includes("555"), "search can match phone");
  const s = stats([{ id: "c1" }], [{ customerId: "c1", totalUnits: 10, totalAmount: .5, paymentType: "cash" }, { customerId: "c1", totalUnits: 6, totalAmount: .3, paymentType: "credit" }]);
  console.assert(s.c1.units === 16 && s.c1.cash === .5 && s.c1.credit === .3, "stats split cash and credit");
}

function App() {
  const [db, setDb] = useState(load);
  const [tab, setTab] = useState("pos");
  const [role, setRole] = useState("employee");
  const [pin, setPin] = useState("");
  const [entries, setEntries] = useState([]);
  const [manual, setManual] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [custForm, setCustForm] = useState(EMPTY_CUSTOMER);
  const [custSearch, setCustSearch] = useState("");
  const [accountSearch, setAccountSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [folderId, setFolderId] = useState(null);
  const [payType, setPayType] = useState("cash");
  const [txSearch, setTxSearch] = useState("");
  const [startCash, setStartCash] = useState("");
  const [endCash, setEndCash] = useState("");
  const [settingsDraft, setSettingsDraft] = useState(db.settings);

  const { settings, customers, txs, shifts } = db;
  const manager = role === "manager";
  const activeShift = shifts.find(s => !s.endedAt);
  const selected = customers.find(c => c.id === selectedId);
  const folder = customers.find(c => c.id === folderId);
  const st = useMemo(() => stats(customers, txs), [customers, txs]);

  useEffect(() => runTests(), []);
  useEffect(() => localStorage.setItem(KEY, JSON.stringify(db)), [db]);
  useEffect(() => setSettingsDraft(settings), [settings]);

  const totalUnits = entries.reduce((a, e) => a + e.units, 0);
  const totalAmount = totalUnits * Number(settings.depositRate || 0);
  const today = txs.filter(t => day(t.createdAt) === day() && !t.voidedAt);
  const daily = { count: today.length, units: today.reduce((a, t) => a + t.totalUnits, 0), paid: today.reduce((a, t) => a + t.totalAmount, 0) };
  const cashToday = today.filter(t => t.paymentType !== "credit").reduce((a, t) => a + t.totalAmount, 0);
  const creditToday = today.filter(t => t.paymentType === "credit").reduce((a, t) => a + t.totalAmount, 0);
  const creditLiability = customers.reduce((a, c) => a + Number(c.balance || 0), 0);
  const shiftPaid = txs.filter(t => activeShift && t.shiftId === activeShift.id && !t.voidedAt && t.paymentType !== "credit").reduce((a, t) => a + t.totalAmount, 0);
  const expectedDrawer = Number(activeShift?.startCash || 0) - shiftPaid;
  const topCustomers = customers.map(c => ({ c, s: st[c.id] || { total: 0, units: 0, tx: 0 } })).sort((a, b) => b.s.total - a.s.total).slice(0, 5);
  const accountMatches = accountSearch ? customers.filter(c => text(c.name, c.phone, c.email, c.notes).includes(accountSearch.toLowerCase())) : customers.slice(0, 8);
  const visibleCustomers = customers.filter(c => text(c.name, c.phone, c.email, c.notes).includes(custSearch.toLowerCase()));
  const visibleTx = txs.filter(t => text(t.receipt, t.customerName, t.totalUnits, t.totalAmount, t.paymentType).includes(txSearch.toLowerCase()));
  const folderTx = txs.filter(t => t.customerId === folderId && !t.voidedAt);

  const patch = (p) => setDb(d => ({ ...d, ...p }));
  const addUnits = (label, units) => setEntries(e => [{ id: uid(), label, units, amount: units * settings.depositRate, createdAt: new Date().toISOString() }, ...e]);
  const addManual = () => { const n = Math.floor(Number(manual)); if (!n) return false; addUnits(`Manual ${n}`, n); setManual(""); return true; };
  function checkout() {
    if (!totalUnits) return;
    const tx = { id: uid(), receipt: Math.floor(100000 + Math.random() * 900000), entries, totalUnits, totalAmount, paymentType: payType, customerId: selected?.id || null, customerName: selected?.name || "Walk-in", cashier: settings.cashierName, shiftId: activeShift?.id || null, createdAt: new Date().toISOString() };
    setDb(d => ({ ...d, customers: payType === "credit" && selected ? d.customers.map(c => c.id === selected.id ? { ...c, balance: Number(c.balance || 0) + totalAmount } : c) : d.customers, txs: [tx, ...d.txs] }));
    setEntries([]); setPayType("cash"); if (manager) setTab("reports");
  }
  function saveCustomer() {
    if (!custForm.name.trim()) return;
    const c = { id: uid(), balance: 0, createdAt: new Date().toISOString(), ...custForm, name: custForm.name.trim() };
    setDb(d => ({ ...d, customers: [c, ...d.customers] })); setSelectedId(c.id); setAccountSearch(c.name); setCustForm(EMPTY_CUSTOMER);
  }
  function deleteCustomer(id) {
    if (prompt("Manager PIN") !== settings.managerPin) return alert("Incorrect PIN");
    setDb(d => ({ ...d, customers: d.customers.filter(c => c.id !== id), txs: d.txs.map(t => t.customerId === id ? { ...t, customerId: null, customerName: "Deleted customer" } : t) }));
  }
  function voidTx(id) {
    if (prompt("Manager PIN") !== settings.managerPin) return alert("Incorrect PIN");
    setDb(d => ({ ...d, txs: d.txs.map(t => t.id === id ? { ...t, voidedAt: new Date().toISOString() } : t) }));
  }
  function exportCsv(name, rows) {
    const csv = rows.map(r => r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = name; a.click(); URL.revokeObjectURL(a.href);
  }
  const exportTx = () => exportCsv("transactions.csv", [["Receipt", "Date", "Customer", "Units", "Amount", "Payment", "Status"], ...txs.map(t => [t.receipt, new Date(t.createdAt).toLocaleString(), t.customerName, t.totalUnits, t.totalAmount, t.paymentType, t.voidedAt ? "VOID" : "OK"])]);
  const exportCust = () => exportCsv("customers.csv", [["Name", "Phone", "Email", "Tx", "Units", "History", "Cash", "Credit Balance", "Notes"], ...customers.map(c => { const s = st[c.id] || {}; return [c.name, c.phone, c.email, s.tx || 0, s.units || 0, s.total || 0, s.cash || 0, c.balance || 0, c.notes]; })]);

  const S = {
    page: { minHeight: "100vh", background: "#f1f5f9", color: "#0f172a", fontFamily: "Arial, sans-serif" }, header: { display: "flex", justifyContent: "space-between", gap: 16, padding: 20, background: "white", borderBottom: "1px solid #e2e8f0" }, nav: { display: "flex", gap: 8, flexWrap: "wrap" }, grid3: { display: "grid", gridTemplateColumns: "1.1fr 1fr .9fr", gap: 16, padding: 16 }, grid2: { display: "grid", gridTemplateColumns: ".85fr 1.15fr", gap: 16, padding: 16 }, card: { background: "white", border: "1px solid #e2e8f0", borderRadius: 18, padding: 18 }, stat: { background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 16, padding: 14 }, btn: { border: "1px solid #cbd5e1", background: "white", padding: "10px 13px", borderRadius: 12, cursor: "pointer", fontWeight: 700 }, primary: { border: 0, background: "#0f172a", color: "white", padding: 16, borderRadius: 16, cursor: "pointer", fontWeight: 800, width: "100%" }, green: { border: 0, background: "#22c55e", color: "white", padding: 20, borderRadius: 16, textAlign: "left", cursor: "pointer" }, danger: { border: "1px solid #fecaca", background: "#fff1f2", color: "#be123c", padding: "8px 10px", borderRadius: 10, cursor: "pointer", fontWeight: 800 }, input: { border: "1px solid #cbd5e1", borderRadius: 12, padding: 12, fontSize: 16, width: "100%", boxSizing: "border-box" }, disabled: { opacity: .45, cursor: "not-allowed" }
  };
  const Btn = ({ name, children }) => <button style={{ ...S.btn, background: tab === name ? "#0f172a" : "white", color: tab === name ? "white" : "#0f172a" }} onClick={() => setTab(name)}>{children}</button>;
  const Field = ({ label, value, onChange, textarea }) => <label><b>{label}</b>{textarea ? <textarea value={value} onChange={e => onChange(e.target.value)} style={{ ...S.input, minHeight: 80, margin: "6px 0 10px" }} /> : <input value={value} onChange={e => onChange(e.target.value)} style={{ ...S.input, margin: "6px 0 10px" }} />}</label>;

  return <div style={S.page}>
    <header style={S.header}><div><h1 style={{ margin: 0 }}>{settings.businessName}</h1><p style={{ margin: "6px 0 0", color: "#64748b" }}>Unit POS • {money(settings.depositRate)} • {activeShift ? "Shift open" : "No shift"}</p></div><div style={S.nav}><Btn name="pos">Employee POS</Btn>{manager && <Btn name="analytics">Analytics</Btn>}{manager && <Btn name="customers">Customers</Btn>}{manager && <Btn name="reports">Reports</Btn>}<Btn name="shifts">Shifts</Btn>{manager && <Btn name="settings">Settings</Btn>}{manager ? <button style={S.btn} onClick={() => { setRole("employee"); setTab("pos"); }}>Employee Mode</button> : <><input placeholder="Manager PIN" type="password" value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ""))} onKeyDown={e => e.key === "Enter" && (pin === settings.managerPin ? (setRole("manager"), setTab("analytics"), setPin("")) : alert("Incorrect PIN"))} style={{ ...S.input, width: 130, padding: 9 }} /><button style={S.btn} onClick={() => pin === settings.managerPin ? (setRole("manager"), setTab("analytics"), setPin("")) : alert("Incorrect PIN")}>Manager</button></>}{manager && <button style={S.btn} onClick={() => confirm("Reset all data?") && (setDb({ settings, customers: [], txs: [], shifts: [] }), localStorage.removeItem(KEY))}>Reset</button>}</div></header>

    {tab === "pos" && <main style={S.grid3}><section style={S.card}><h2>{manager ? "Fast Count" : "Employee Checkout"}</h2><div style={{ ...S.stat, marginBottom: 14 }}><b>Customer Account</b><select value={selectedId} onChange={e => { const c = customers.find(x => x.id === e.target.value); setSelectedId(e.target.value); setAccountSearch(c?.name || ""); if (!c) setPayType("cash"); }} style={{ ...S.input, marginTop: 8 }}><option value="">Walk-in Customer</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` • ${c.phone}` : ""}</option>)}</select><input placeholder="Search accounts" value={accountSearch} onChange={e => { setAccountSearch(e.target.value); if (!e.target.value.trim()) setSelectedId(""); }} style={{ ...S.input, marginTop: 8 }} /><div style={{ maxHeight: 180, overflow: "auto", border: "1px solid #e2e8f0", borderRadius: 12, marginTop: 8 }}>{accountMatches.length ? accountMatches.map(c => <button key={c.id} style={{ ...S.btn, width: "100%", textAlign: "left", borderRadius: 0, background: selectedId === c.id ? "#eff6ff" : "white" }} onClick={() => (setSelectedId(c.id), setAccountSearch(c.name))}><b>{c.name}</b><br /><small>{c.phone || "No phone"} • {st[c.id]?.units || 0} units • {money(c.balance || 0)} credit</small></button>) : <div style={{ padding: 10, color: "#94a3b8" }}>No matches</div>}</div><div style={{ display: "flex", gap: 8, marginTop: 8 }}>{manager && <button style={S.btn} onClick={() => setTab("customers")}>Manage</button>}{manager && <button disabled={!selected} style={{ ...S.btn, ...(!selected ? S.disabled : {}) }} onClick={() => setFolderId(selected.id)}>Folder</button>}<button disabled={!selected} style={{ ...S.btn, ...(!selected ? S.disabled : {}) }} onClick={() => (setSelectedId(""), setAccountSearch(""), setPayType("cash"))}>Clear</button></div>{selected && <p>Lifetime: {st[selected.id]?.units || 0} units • {money(st[selected.id]?.total || 0)} history • {money(selected.balance || 0)} credit</p>}</div><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>{PRESETS.map(([label, units, popup]) => <button key={label} style={S.green} onClick={() => popup ? setShowManual(true) : addUnits(label, units)}><b style={{ fontSize: 19 }}>{label}</b><br /><small>{popup ? "Type loose units" : `${units} units • ${money(units * settings.depositRate)}`}</small></button>)}</div></section><section style={S.card}><h2>Current Ticket</h2><div style={{ height: 520, overflow: "auto", border: "1px solid #e2e8f0", borderRadius: 14 }}>{entries.length ? entries.map(e => <div key={e.id} style={{ display: "flex", justifyContent: "space-between", padding: 12, borderBottom: "1px solid #e2e8f0" }}><span><b>{e.label}</b><br /><small>{e.units} units • {money(e.amount)}</small></span><button style={S.btn} onClick={() => setEntries(v => v.filter(x => x.id !== e.id))}>Remove</button></div>) : <div style={{ padding: 30, color: "#94a3b8" }}>No items yet</div>}</div><button style={{ ...S.btn, marginTop: 10 }} onClick={() => setEntries(v => v.slice(1))}>Undo</button></section><section style={S.card}><h2>Checkout</h2><div style={S.stat}><b>Customer:</b> {selected?.name || "Walk-in"}</div><div style={{ margin: "12px 0" }}><b>Payment</b><br /><button style={{ ...S.btn, background: payType === "cash" ? "#0f172a" : "white", color: payType === "cash" ? "white" : "#0f172a", marginRight: 8 }} onClick={() => setPayType("cash")}>Cash</button><button disabled={!selected} style={{ ...S.btn, background: payType === "credit" ? "#0f172a" : "white", color: payType === "credit" ? "white" : "#0f172a", ...(!selected ? S.disabled : {}) }} onClick={() => selected && setPayType("credit")}>Credit Account</button></div><div style={{ background: "#0f172a", color: "white", borderRadius: 18, padding: 20 }}><div>Total Units: <b>{totalUnits}</b></div><div>Rate: <b>{money(settings.depositRate)}</b></div><hr /><div>Payout</div><div style={{ fontSize: 46, fontWeight: 900 }}>{money(totalAmount)}</div></div><button disabled={!entries.length} style={{ ...S.primary, marginTop: 12, ...(!entries.length ? S.disabled : {}) }} onClick={checkout}>Complete Checkout</button><button style={{ ...S.btn, width: "100%", marginTop: 8 }} onClick={() => setEntries([])}>Clear</button><div style={{ ...S.stat, marginTop: 12 }}>Today: {daily.count} tx • {daily.units} units • {money(daily.paid)}</div></section></main>}
    {tab === "analytics" && manager && <main style={S.grid2}><section style={S.card}><h2>Manager Analytics</h2><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>{[["Transactions", daily.count], ["Units", daily.units], ["Cash Paid", money(cashToday)], ["Credited", money(creditToday)], ["Credit Liability", money(creditLiability)], ["Expected Drawer", activeShift ? money(expectedDrawer) : "No shift"]].map(([k, v]) => <div key={k} style={S.stat}><small>{k}</small><div style={{ fontSize: 28, fontWeight: 900 }}>{v}</div></div>)}</div></section><section style={S.card}><h2>Top Accounts</h2>{topCustomers.length ? topCustomers.map(({ c, s }, i) => <div key={c.id} style={{ ...S.stat, marginBottom: 8 }}>#{i + 1} <b>{c.name}</b> — {s.tx} tx • {s.units} units • {money(s.total)}</div>) : <p>No activity yet.</p>}<button style={S.primary} onClick={exportTx}>Export Transactions</button><button style={{ ...S.btn, width: "100%", marginTop: 8 }} onClick={exportCust}>Export Customers</button></section></main>}
    {tab === "customers" && manager && <main style={S.grid2}><section style={S.card}><h2>Add Customer</h2><Field label="Name" value={custForm.name} onChange={v => setCustForm({ ...custForm, name: v })} /><Field label="Phone" value={custForm.phone} onChange={v => setCustForm({ ...custForm, phone: v })} /><Field label="Email" value={custForm.email} onChange={v => setCustForm({ ...custForm, email: v })} /><Field label="Notes" textarea value={custForm.notes} onChange={v => setCustForm({ ...custForm, notes: v })} /><button style={S.primary} onClick={saveCustomer}>Save Customer</button></section><section style={S.card}><h2>Customer Database</h2><input placeholder="Search customers" value={custSearch} onChange={e => setCustSearch(e.target.value)} style={S.input} />{visibleCustomers.map(c => { const s = st[c.id] || {}; return <div key={c.id} style={{ ...S.stat, marginTop: 8 }}><b>{c.name}</b> <small>{c.phone}</small><br />{s.tx || 0} tx • {s.units || 0} units • {money(s.total || 0)} history • {money(c.balance || 0)} credit<br /><button style={S.btn} onClick={() => (setSelectedId(c.id), setAccountSearch(c.name), setTab("pos"))}>Use</button> <button style={S.btn} onClick={() => setFolderId(c.id)}>View</button> <button style={S.danger} onClick={() => deleteCustomer(c.id)}>Delete</button></div>; })}</section></main>}
    {tab === "reports" && manager && <main style={S.grid2}><section style={S.card}><h2>Daily Report</h2><div style={S.stat}>{daily.count} tx • {daily.units} units • {money(daily.paid)}</div><button style={{ ...S.primary, marginTop: 10 }} onClick={exportTx}>Export CSV</button></section><section style={S.card}><h2>Transactions</h2><input placeholder="Search transactions" value={txSearch} onChange={e => setTxSearch(e.target.value)} style={S.input} />{visibleTx.map(t => <div key={t.id} style={{ ...S.stat, marginTop: 8, background: t.voidedAt ? "#fff1f2" : "#f8fafc" }}>#{t.receipt} • <b>{t.customerName}</b> • {t.totalUnits} units • {money(t.totalAmount)} • {t.paymentType}{t.voidedAt ? " • VOID" : ""}{!t.voidedAt && <><br /><button style={S.danger} onClick={() => voidTx(t.id)}>Void</button></>}</div>)}</section></main>}
    {tab === "shifts" && <main style={S.grid2}><section style={S.card}><h2>Cash Drawer</h2>{!activeShift ? <><input placeholder="Starting cash" value={startCash} onChange={e => setStartCash(e.target.value.replace(/[^0-9.]/g, ""))} style={S.input} /><button style={{ ...S.primary, marginTop: 10 }} onClick={() => { const n = Number(startCash); if (Number.isFinite(n)) patch({ shifts: [{ id: uid(), startCash: n, startedAt: new Date().toISOString(), endedAt: null }, ...shifts] }); setStartCash(""); }}>Start Shift</button></> : <><div style={S.stat}>Start: {money(activeShift.startCash)}<br />Cash payouts: {money(shiftPaid)}<br />Expected drawer: {money(expectedDrawer)}</div><input placeholder="Ending cash" value={endCash} onChange={e => setEndCash(e.target.value.replace(/[^0-9.]/g, ""))} style={{ ...S.input, marginTop: 10 }} /><button style={{ ...S.primary, marginTop: 10 }} onClick={() => { const n = Number(endCash); if (Number.isFinite(n)) patch({ shifts: shifts.map(s => s.id === activeShift.id ? { ...s, endCash: n, expectedEndCash: expectedDrawer, overShort: n - expectedDrawer, endedAt: new Date().toISOString() } : s) }); setEndCash(""); }}>End Shift</button></>}</section><section style={S.card}><h2>Shift History</h2>{shifts.map(s => <div key={s.id} style={{ ...S.stat, marginTop: 8 }}>{new Date(s.startedAt).toLocaleString()}<br />Start {money(s.startCash)} • End {s.endCash == null ? "—" : money(s.endCash)} • O/S {s.endedAt ? money(s.overShort) : "—"}</div>)}</section></main>}
    {tab === "settings" && manager && <main style={S.grid2}><section style={S.card}><h2>Settings</h2><Field label="Business Name" value={settingsDraft.businessName} onChange={v => setSettingsDraft({ ...settingsDraft, businessName: v })} /><Field label="Cashier Name" value={settingsDraft.cashierName} onChange={v => setSettingsDraft({ ...settingsDraft, cashierName: v })} /><Field label="Deposit Rate" value={settingsDraft.depositRate} onChange={v => setSettingsDraft({ ...settingsDraft, depositRate: v.replace(/[^0-9.]/g, "") })} /><Field label="Manager PIN" value={settingsDraft.managerPin} onChange={v => setSettingsDraft({ ...settingsDraft, managerPin: v.replace(/\D/g, "") })} /><button style={S.primary} onClick={() => patch({ settings: { ...settingsDraft, depositRate: Number(settingsDraft.depositRate) || .05 } })}>Save</button></section><section style={S.card}><h2>Notes</h2><div style={S.stat}>Employee mode is simple. Manager mode unlocks analytics, accounts, reports, exports, voids, deletes, and settings.</div></section></main>}
    {folderId && <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", display: "grid", placeItems: "center", zIndex: 5 }}><div style={{ ...S.card, width: 680, maxHeight: "80vh", overflow: "auto" }}><h2>{folder?.name || "Customer"} Folder</h2><div style={S.stat}>{st[folderId]?.units || 0} units • {money(st[folderId]?.total || 0)} history • {money(st[folderId]?.cash || 0)} cash • {money(folder?.balance || 0)} credit</div>{folderTx.map(t => <div key={t.id} style={{ borderBottom: "1px solid #e2e8f0", padding: 10 }}>{new Date(t.createdAt).toLocaleString()} • {t.totalUnits} units • {money(t.totalAmount)} • {t.paymentType}</div>)}<button style={{ ...S.btn, marginTop: 10 }} onClick={() => setFolderId(null)}>Close</button></div></div>}
    {showManual && <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", display: "grid", placeItems: "center", zIndex: 6 }}><div style={{ ...S.card, width: 320 }}><h2>Enter Loose Units</h2><input autoFocus value={manual} onChange={e => setManual(e.target.value.replace(/\D/g, ""))} onKeyDown={e => e.key === "Enter" && addManual() && setShowManual(false)} style={S.input} /><button style={{ ...S.primary, marginTop: 10 }} onClick={() => addManual() && setShowManual(false)}>Add</button><button style={{ ...S.btn, width: "100%", marginTop: 8 }} onClick={() => (setShowManual(false), setManual(""))}>Cancel</button></div></div>}
  </div>;
}

createRoot(document.getElementById("root")).render(<App />);

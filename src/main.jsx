import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { Elements } from '@stripe/react-stripe-js'
import { getStripePromise } from './stripe.js'

// Resolves to a Stripe instance once the publishable key is fetched, or null
// in stub mode. <Elements> accepts null and just won't expose useStripe(),
// which the card form gracefully detects and falls back to demo flow.
const stripePromise = getStripePromise();

// Top-level error boundary so a single bad component can't blank the whole
// page. React 18+ still falls back to white-screen on uncaught render errors;
// this catches them and shows a recoverable UI instead of a silent crash.
class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    // Send to console + best-effort to a logging endpoint so prod errors are
    // visible. The endpoint may not exist in dev — failure is silent.
    console.error("[Bundly app crash]", error, info);
    try {
      fetch("/api/client-error", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          message: String(error?.message || error).slice(0, 500),
          stack:   String(error?.stack || "").slice(0, 2000),
          componentStack: String(info?.componentStack || "").slice(0, 2000),
          url:     typeof location !== "undefined" ? location.href : "",
          ts:      new Date().toISOString(),
        }),
      }).catch(() => {});
    } catch {}
  }
  reset = () => this.setState({ error: null });
  render() {
    if (this.state.error) {
      return (
        <div dir="rtl" style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, -apple-system, Heebo, Assistant, sans-serif",
          background: "linear-gradient(135deg, #fef3c7, #fee2e2)",
          padding: "20px",
        }}>
          <div style={{
            background: "white",
            borderRadius: "24px",
            padding: "32px",
            maxWidth: "500px",
            boxShadow: "0 20px 60px rgba(0,0,0,0.1)",
            textAlign: "center",
          }}>
            <div style={{ fontSize: "48px", marginBottom: "16px" }}>😔</div>
            <h1 style={{ fontSize: "20px", fontWeight: 900, color: "#111827", marginBottom: "8px" }}>
              משהו השתבש
            </h1>
            <p style={{ fontSize: "14px", color: "#6b7280", lineHeight: 1.6, marginBottom: "20px" }}>
              נתקלנו בתקלה לא צפויה. ניסינו לדווח עליה לצוות הפיתוח.
              אפשר לנסות שוב או לרענן את הדף.
            </p>
            <div style={{ display: "flex", gap: "8px", justifyContent: "center" }}>
              <button onClick={this.reset} style={{
                background: "linear-gradient(135deg, #4f46e5, #7c3aed)",
                color: "white", fontWeight: 800, padding: "10px 20px",
                borderRadius: "12px", border: "none", cursor: "pointer", fontSize: "13px",
              }}>נסה שוב</button>
              <button onClick={() => location.reload()} style={{
                background: "#f3f4f6", color: "#374151", fontWeight: 700,
                padding: "10px 20px", borderRadius: "12px", border: "none", cursor: "pointer", fontSize: "13px",
              }}>רענן דף</button>
            </div>
            {process.env.NODE_ENV !== "production" && (
              <details style={{ marginTop: "20px", textAlign: "left", fontSize: "11px", color: "#9ca3af" }}>
                <summary style={{ cursor: "pointer" }}>פרטי שגיאה (dev only)</summary>
                <pre style={{ background: "#f9fafb", padding: "12px", borderRadius: "8px", marginTop: "8px", overflow: "auto", maxHeight: "200px" }}>
                  {String(this.state.error?.stack || this.state.error)}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <Elements stripe={stripePromise}>
        <App />
      </Elements>
    </AppErrorBoundary>
  </React.StrictMode>,
)

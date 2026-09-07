import Link from 'next/link';

/** The one-row header. The active view takes the accent outline, the other stays ghost. */
export function Masthead({ view }: { view: 'dashboard' | 'imports' | 'corporate' }) {
  return (
    <header className="masthead">
      <div className="masthead-left">
        <h1 className="masthead-title">Work Order Operations</h1>
        <div className="masthead-rule" />
        <div className="masthead-org">Noontide Service Corporation USA Inc.</div>
      </div>
      <nav className="masthead-nav">
        <Link href="/" className={`btn ${view === 'dashboard' ? 'btn-active' : 'btn-ghost'}`}>
          Work Orders
        </Link>
        <Link
          href="/corporate"
          className={`btn ${view === 'corporate' ? 'btn-active' : 'btn-ghost'}`}
        >
          Customers
        </Link>
        <Link href="/imports" className={`btn ${view === 'imports' ? 'btn-active' : 'btn-ghost'}`}>
          Import log
        </Link>
      </nav>
    </header>
  );
}

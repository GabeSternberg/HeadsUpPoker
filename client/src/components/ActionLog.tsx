import { useEffect, useRef, useState } from 'react';

export default function ActionLog({ log, isMobile }: { log: string[]; isMobile?: boolean }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(true);

  useEffect(() => {
    if (!collapsed) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [log.length, collapsed]);

  if (isMobile) {
    return (
      <div className="action-log">
        <h3 className="action-log-toggle" onClick={() => setCollapsed(c => !c)}>
          Action Log {collapsed ? '▸' : '▾'}
        </h3>
        {!collapsed && (
          <div className="log-entries">
            {log.map((entry, i) => (
              <div key={i} className={`log-entry ${entry.startsWith('---') ? 'log-round' : ''}`}>
                {entry}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="action-log">
      <h3>Action Log</h3>
      <div className="log-entries">
        {log.map((entry, i) => (
          <div key={i} className={`log-entry ${entry.startsWith('---') ? 'log-round' : ''}`}>
            {entry}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

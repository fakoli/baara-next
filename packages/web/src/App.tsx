import { useState } from 'react';
import Header from './components/Header.tsx';
import ThreadList, { ThreadListExpandButton } from './components/ThreadList.tsx';
import ChatWindow from './components/ChatWindow.tsx';
import ControlPanel, { ControlPanelExpandButton } from './components/ControlPanel.tsx';

export default function App() {
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        overflow: 'hidden',
        background: 'var(--bg-deep)',
      }}
    >
      {/* Header — full width, 44px tall */}
      <Header />

      {/* Three-zone layout */}
      <div
        style={{
          display: 'flex',
          flex: 1,
          overflow: 'hidden',
          minHeight: 0,
        }}
      >
        {/* Left sidebar — collapsible thread navigator */}
        <ThreadList
          collapsed={leftCollapsed}
          onCollapse={() => setLeftCollapsed(true)}
        />

        {/* Expand button for left sidebar when collapsed */}
        {leftCollapsed && (
          <ThreadListExpandButton onClick={() => setLeftCollapsed(false)} />
        )}

        {/* Center — primary chat window */}
        <ChatWindow />

        {/* Right panel — collapsible tabbed control center */}
        <ControlPanel
          collapsed={rightCollapsed}
          onCollapse={() => setRightCollapsed(true)}
        />

        {/* Expand button for right panel when collapsed */}
        {rightCollapsed && (
          <ControlPanelExpandButton onClick={() => setRightCollapsed(false)} />
        )}
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Flag, Play, Pause, Trophy, RotateCcw, ArrowLeft, ChevronDown, X, Target } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useFactoryStore } from '../store';
import { FIRST_SHIFT, challengeMetrics } from '../game/challenge';
import './challenge.css';

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;

export function ChallengePanel() {
    const state = useFactoryStore();
    const [briefing, setBriefing] = useState(false);
    const [collapsed, setCollapsed] = useState(() => window.matchMedia('(max-width: 700px)').matches);
    const dialogRef = useRef<HTMLElement>(null);
    const run = state.challenge;
    const finished = run?.status === 'won' || run?.status === 'failed';
    const metrics = run ? challengeMetrics(run, state.credits) : null;
    const modalOpen = briefing || finished;
    const openBriefing = () => {
        if (run && state.isRunning) state.setIsPaused(true);
        setBriefing(true);
    };
    useEffect(() => {
        if (!modalOpen) return;
        const previousFocus = document.activeElement as HTMLElement | null;
        dialogRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && !finished) { event.preventDefault(); setBriefing(false); }
            if (event.key !== 'Tab') return;
            const buttons = dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
            if (!buttons?.length) return;
            const first = buttons[0], last = buttons[buttons.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        };
        document.addEventListener('keydown', onKey);
        return () => { document.removeEventListener('keydown', onKey); previousFocus?.focus(); };
    }, [modalOpen, finished]);
    return <div className="game-layer">
        <nav className="game-modes" aria-label="Game mode">
            <button className={!run ? 'active' : ''} onClick={() => state.exitChallenge()}>Sandbox</button>
            <button className={run ? 'active' : ''} onClick={openBriefing}><Flag size={13} /> Challenges <span className="game-new">01</span></button>
        </nav>
        {run && <section className="order-panel" aria-label="Production order">
            <button className="order-heading" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed}>
                <span><span className="game-eyebrow">ORDER 01 / {run.status === 'planning' ? 'PLAN YOUR LINE' : state.isPaused && !finished ? 'PAUSED' : run.status.toUpperCase()}</span><strong>First Shift</strong></span>
                <ChevronDown size={16} style={{ transform: collapsed ? 'rotate(-90deg)' : undefined }} />
            </button>
            {!collapsed && <>
                <div className={`order-clock ${FIRST_SHIFT.duration - run.elapsed < 30 ? 'urgent' : ''}`}><span>SHIFT REMAINING</span><strong>{clock(Math.max(0, FIRST_SHIFT.duration - run.elapsed))}</strong></div>
                {FIRST_SHIFT.orders.map((order, i) => <div className="order-line" key={order.receiverId}>
                    <div className="order-line-title"><span className="order-dot" style={{ background: order.color }} /><b>{order.label}</b><span>{Math.min(run.accepted[i], order.quantity)} / {order.quantity}</span></div>
                    <progress max={order.quantity} value={Math.min(run.accepted[i], order.quantity)} aria-label={`${order.label} delivered`} style={{ accentColor: order.color, color: order.color }} />
                    <button className="order-locate" onClick={() => state.setSelectedItemId(order.receiverId)}><Target size={11} /> Locate {i === 0 ? 'left' : 'right'} receiver</button>
                </div>)}
                <div className="order-mini-stats"><span>Rejected <b>{run.rejected}</b></span><span>Fed <b>{run.spawned}/{FIRST_SHIFT.batchSize}</b></span><span>Budget <b>{state.credits.toLocaleString()}</b></span></div>
                {run.status === 'planning' && <p className="order-tip">A working line is ready. Tune the robots or add equipment before starting. Marked receivers and the feed are fixed.</p>}
                <button className="game-primary order-start" disabled={finished} onClick={() => {
                    if (!state.isRunning) state.setIsRunning(true);
                    else state.setIsPaused(!state.isPaused);
                }}>{!state.isRunning || state.isPaused ? <Play size={14} /> : <Pause size={14} />}{!state.isRunning ? 'Start shift' : state.isPaused ? 'Resume shift' : 'Pause shift'}</button>
                <div className="order-actions"><button onClick={() => state.retryChallenge()}><RotateCcw size={12} /> Retry layout</button><button onClick={openBriefing}>Briefing</button></div>
            </>}
        </section>}
        {(briefing || finished) && createPortal(<div className="game-backdrop">
            <section ref={dialogRef} className="game-dialog" role="dialog" aria-modal="true" aria-labelledby="game-dialog-title">
                {briefing && !finished && <button className="game-close" aria-label="Close briefing" onClick={() => setBriefing(false)}><X size={19} /></button>}
                <div className="game-dialog-icon">{finished ? <Trophy size={29} /> : <Flag size={29} />}</div>
                <div className="game-eyebrow">COBOT FACTORY / CHALLENGE 01</div>
                <h2 id="game-dialog-title">{finished ? run.status === 'won' ? 'Order fulfilled.' : 'Shift ended.' : 'Your first real order.'}</h2>
                <p className="game-intro">{finished ? run.status === 'won' ? `${metrics?.medal} medal. Your factory delivered both orders.` : 'The order is unfinished. Adjust your line and try again.' : 'Two products. Two destinations. Build a line that delivers the right parts, on time.'}</p>
                {finished && metrics ? <>
                    <div className={`game-medal ${metrics.medal?.toLowerCase() ?? 'unfinished'}`}><Trophy size={18} /> {metrics.medal ? `${metrics.medal} shift` : 'Keep building'}</div>
                    <div className="game-results">
                        <div><span>DELIVERED</span><strong>{run.accepted.map((value, i) => `${Math.min(value, FIRST_SHIFT.orders[i].quantity)}/${FIRST_SHIFT.orders[i].quantity}`).join(' + ')}</strong></div>
                        <div><span>ELAPSED</span><strong>{clock(run.elapsed)}</strong></div>
                        <div><span>SORTING ACCURACY</span><strong>{Math.round(metrics.accuracy * 100)}%</strong></div>
                        <div><span>THROUGHPUT</span><strong>{metrics.throughput.toFixed(1)} <small>/min</small></strong></div>
                        <div><span>EQUIPMENT COST</span><strong>{metrics.spent.toLocaleString()}</strong></div>
                        <div><span>ROBOT IDLE TIME</span><strong>{Math.round(metrics.idle * 100)}%</strong></div>
                    </div>
                    <p className="game-hint">{run.rejected > 0 ? `${run.rejected} ${run.rejected === 1 ? 'part reached' : 'parts reached'} the wrong outlet or were lost. Check color filters and pickup timing.` : 'Aim for a faster cycle and keep at least 500 credits for a Gold run.'}</p>
                </> : <>
                    <div className="game-order-cards">{FIRST_SHIFT.orders.map((order, i) => <div key={order.receiverId}><span className="order-dot" style={{ background: order.color }} /><strong>{order.quantity} {order.label.toLowerCase()}</strong><span>{i === 0 ? 'Left' : 'Right'} receiver</span></div>)}</div>
                    <div className="game-brief-stats"><span><b>3:00</b> shift limit</span><span><b>5,500</b> total budget</span><span><b>24</b> incoming parts</span></div>
                    <p className="game-hint">The starter equipment is included in the budget. The feed repeats red / blue / red every four seconds. Parts reaching the end outlet count as rejects. Pause to inspect; retry to change the layout.</p>
                    <div className="game-medal-rules"><b>Gold</b> ≤90s, ≥80% accuracy, ≥500 credits left<br /><b>Silver</b> ≤135s, ≥60% accuracy · <b>Bronze</b> finish the order</div>
                </>}
                <div className="game-dialog-actions">
                    <button className="game-primary" onClick={() => {
                        if (finished) state.retryChallenge();
                        else if (!run) state.enterChallenge();
                        setBriefing(false);
                    }}>{finished ? <RotateCcw size={16} /> : <Flag size={16} />}{finished ? 'Improve & retry' : run ? 'Back to factory' : 'Open First Shift'}</button>
                    <button className="game-secondary" onClick={() => { state.exitChallenge(); setBriefing(false); }}><ArrowLeft size={15} /> Sandbox</button>
                </div>
                <p className="game-save-note">Your saved Sandbox layout is kept separate.</p>
            </section>
        </div>, document.body)}
    </div>;
}

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';

interface MSAViewerProps {
    alignment: string;
}

interface ParsedSequence {
    id: string;
    seq: string;
}

/* ── colour palette ───────────────────────────────────── */
const NT_COLORS: Record<string, { bg: string; fg: string }> = {
    A: { bg: '#fee2e2', fg: '#991b1b' },
    T: { bg: '#dbeafe', fg: '#1e40af' },
    G: { bg: '#fef9c3', fg: '#854d0e' },
    C: { bg: '#dcfce7', fg: '#166534' },
    '-': { bg: '#f3f4f6', fg: '#9ca3af' },
};

/* ── constants ────────────────────────────────────────── */
const LABEL_WIDTH = 140;
const RULER_HEIGHT = 24;
const ROW_HEIGHT = 18;
const VIEWER_HEIGHT = 500;
const BP_THRESHOLD = 100;
const HYSTERESIS = 15;
const MINIMAP_GC_H = 40;
const MINIMAP_RULER_H = 14;
const MINIMAP_HANDLE_H = 8;
const MINIMAP_HEIGHT = MINIMAP_GC_H + MINIMAP_RULER_H + 50 + MINIMAP_HANDLE_H;

const MSAViewer: React.FC<MSAViewerProps> = ({ alignment }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const minimapRef = useRef<HTMLCanvasElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const targetScrollRef = useRef<number | null>(null);
    const isDragging = useRef(false);
    const [availableWidth, setAvailableWidth] = useState(900);
    const [scrollLeft, setScrollLeft] = useState(0);
    const [viewFraction, setViewFraction] = useState(1);
    const [viewMode, setViewMode] = useState<'bars' | 'letters'>('bars');
    const [copyFeedback, setCopyFeedback] = useState('');

    /* ── parse FASTA ────────────────────────────────────── */
    const sequences = useMemo<ParsedSequence[]>(() => {
        if (!alignment) return [];
        const lines = alignment.trim().split('\n');
        const seqs: ParsedSequence[] = [];
        let cur = '';
        let seq = '';
        lines.forEach((l) => {
            if (l.startsWith('>')) {
                if (cur) seqs.push({ id: cur, seq });
                cur = l.substring(1).trim();
                seq = '';
            } else {
                seq += l.trim();
            }
        });
        if (cur) seqs.push({ id: cur, seq });
        return seqs;
    }, [alignment]);

    const seqLen = sequences.length > 0 ? Math.max(...sequences.map((s) => s.seq.length)) : 0;
    const querySeq = sequences.length > 0 ? sequences[0].seq : '';

    /* ── sizing ─────────────────────────────────────────── */
    const seqAreaW = availableWidth - LABEL_WIDTH;
    const totalVirtualW = seqAreaW / viewFraction;
    const cellW = seqLen > 0 ? totalVirtualW / seqLen : 1;
    const visibleBases = seqLen * viewFraction;
    const totalH = RULER_HEIGHT + sequences.length * ROW_HEIGHT + 4;

    /* ── viewport fractions ────────────────────────────── */
    const startFrac = totalVirtualW > 0 ? scrollLeft / totalVirtualW : 0;
    const endFrac = Math.min(1, startFrac + viewFraction);
    const startCol = Math.max(0, Math.floor(startFrac * seqLen));
    const endCol = Math.min(seqLen - 1, Math.ceil(endFrac * seqLen) - 1);

    /* ── auto-switch mode with hysteresis ──────────────── */
    useEffect(() => {
        if (viewMode === 'bars' && visibleBases < BP_THRESHOLD - HYSTERESIS) {
            setViewMode('letters');
        } else if (viewMode === 'letters' && visibleBases > BP_THRESHOLD + HYSTERESIS) {
            setViewMode('bars');
        }
    }, [visibleBases, viewMode]);

    /* ── container resize tracking ──────────────────────── */
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const obs = new ResizeObserver((e) => {
            for (const entry of e) setAvailableWidth(entry.contentRect.width);
        });
        obs.observe(el);
        return () => obs.disconnect();
    }, []);

    /* ── sync programmatic scroll after render ─────────── */
    useEffect(() => {
        if (targetScrollRef.current !== null && scrollRef.current) {
            scrollRef.current.scrollLeft = targetScrollRef.current;
            targetScrollRef.current = null;
        }
    });

    /* ── zoom helpers ─────────────────────────────────── */
    const zoomIn = () => setViewFraction((p) => Math.max(0.005, p * 0.75));
    const zoomOut = () => setViewFraction((p) => Math.min(1, p * 1.33));

    /* ── copy helpers ─────────────────────────────────── */
    const showCopyFeedback = (msg: string) => {
        setCopyFeedback(msg);
        setTimeout(() => setCopyFeedback(''), 2000);
    };

    const copySequence = (seq: ParsedSequence) => {
        const raw = seq.seq.replace(/-/g, '');
        navigator.clipboard.writeText(raw).then(() => {
            showCopyFeedback(`Copied ${seq.id} (${raw.length} bp)`);
        });
    };

    const copyAllFasta = () => {
        const fasta = sequences.map((s) => `>${s.id}\n${s.seq}`).join('\n');
        navigator.clipboard.writeText(fasta).then(() => {
            showCopyFeedback(`Copied ${sequences.length} sequences (FASTA)`);
        });
    };

    const copySelection = () => {
        if (sequences.length === 0) return;
        const query = sequences[0];
        const sub = query.seq.slice(startCol, endCol + 1);
        navigator.clipboard.writeText(sub).then(() => {
            showCopyFeedback(`Copied query pos ${startCol + 1}–${endCol + 1} (${sub.length} bp)`);
        });
    };

    /* ── compute GC content per column ──────────── */
    const gcContent = useMemo(() => {
        if (seqLen === 0 || sequences.length === 0) return [];
        const gc: number[] = new Array(seqLen);
        for (let col = 0; col < seqLen; col++) {
            let gcCount = 0;
            let total = 0;
            for (const s of sequences) {
                const ch = (s.seq[col] || '-').toUpperCase();
                if (ch === '-') continue;
                total++;
                if (ch === 'G' || ch === 'C') gcCount++;
            }
            gc[col] = total > 0 ? gcCount / total : 0;
        }
        return gc;
    }, [sequences, seqLen]);

    /* ── selection statistics (visible range) ─────── */
    const selectionStats = useMemo(() => {
        if (sequences.length === 0) return null;
        const query = sequences[0];
        const sub = query.seq.slice(startCol, endCol + 1).toUpperCase();
        let g = 0, c = 0, a = 0, t = 0, total = 0;
        for (const char of sub) {
            if (char === 'G') g++;
            else if (char === 'C') c++;
            else if (char === 'A') a++;
            else if (char === 'T') t++;
            if (char !== '-') total++;
        }
        const gcPct = total > 0 ? ((g + c) / total) * 100 : 0;
        return { g, c, a, t, total, gcPct };
    }, [sequences, startCol, endCol]);

    /* ══════════════════════════════════════════════════════
       MINIMAP DRAWING
       ══════════════════════════════════════════════════════ */
    const drawMinimap = useCallback(() => {
        const cvs = minimapRef.current;
        if (!cvs || sequences.length === 0) return;
        const ctx = cvs.getContext('2d');
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        cvs.width = availableWidth * dpr;
        cvs.height = MINIMAP_HEIGHT * dpr;
        cvs.style.width = `${availableWidth}px`;
        cvs.style.height = `${MINIMAP_HEIGHT}px`;
        ctx.scale(dpr, dpr);

        const mmSeqW = availableWidth - LABEL_WIDTH;
        const rowsTop = MINIMAP_GC_H + MINIMAP_RULER_H;
        const rowAreaH = MINIMAP_HEIGHT - rowsTop - MINIMAP_HANDLE_H; // subtract handle height
        const rowH = Math.max(1, Math.min(3, rowAreaH / sequences.length));

        // background
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(0, 0, availableWidth, MINIMAP_HEIGHT);

        // ── GC content bar ──
        ctx.fillStyle = '#94a3b8';
        ctx.font = '7px ui-monospace, SFMono-Regular, monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText('GC%', LABEL_WIDTH - 4, MINIMAP_GC_H / 2);
        for (let col = 0; col < seqLen; col++) {
            const x = LABEL_WIDTH + (col / seqLen) * mmSeqW;
            const w = Math.max(1, mmSeqW / seqLen);
            const gc = gcContent[col] || 0;
            // color: low GC = warm yellow/amber, high GC = green/teal
            const r = Math.round(255 - gc * 150);
            const g = Math.round(180 + gc * 60);
            const b = Math.round(50 + gc * 100);
            ctx.fillStyle = `rgb(${r},${g},${b})`;
            const barH = gc * MINIMAP_GC_H;
            ctx.fillRect(x, MINIMAP_GC_H - barH, w, barH);
        }
        // separator below GC bar
        ctx.fillStyle = '#e2e8f0';
        ctx.fillRect(LABEL_WIDTH, MINIMAP_GC_H - 0.5, mmSeqW, 0.5);

        // ── ruler ticks ──
        ctx.fillStyle = '#94a3b8';
        ctx.font = '8px ui-monospace, SFMono-Regular, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        const tickInt = seqLen > 500 ? 100 : seqLen > 200 ? 50 : 10;
        for (let col = 0; col < seqLen; col++) {
            if ((col + 1) % tickInt === 0) {
                const x = LABEL_WIDTH + ((col + 0.5) / seqLen) * mmSeqW;
                ctx.fillStyle = '#cbd5e1';
                ctx.fillRect(x, MINIMAP_GC_H + MINIMAP_RULER_H - 4, 1, 4);
                ctx.fillStyle = '#94a3b8';
                ctx.fillText(String(col + 1), x, MINIMAP_GC_H + MINIMAP_RULER_H - 5);
            }
        }

        // separator line below ruler
        ctx.fillStyle = '#e2e8f0';
        ctx.fillRect(LABEL_WIDTH, rowsTop - 0.5, mmSeqW, 0.5);

        // sequence overview rows
        for (let row = 0; row < sequences.length; row++) {
            const s = sequences[row];
            const y = rowsTop + row * rowH;
            const isQuery = row === 0;

            const sStart = seqStart(s.seq);
            const sEnd = seqEnd(s.seq);
            if (sStart <= sEnd) {
                const x1 = LABEL_WIDTH + (sStart / seqLen) * mmSeqW;
                const x2 = LABEL_WIDTH + ((sEnd + 1) / seqLen) * mmSeqW;
                ctx.fillStyle = isQuery ? '#bfdbfe' : '#d1d5db';
                ctx.fillRect(x1, y, x2 - x1, Math.max(1, rowH - 0.5));
            }

            for (let col = 0; col < seqLen; col++) {
                const ch = (s.seq[col] || '-').toUpperCase();
                const qch = (querySeq[col] || '-').toUpperCase();
                if (ch === '-') continue;
                if (ch !== qch && qch !== '-') {
                    const x = LABEL_WIDTH + (col / seqLen) * mmSeqW;
                    ctx.fillStyle = '#dc2626';
                    ctx.fillRect(x, y, Math.max(1, mmSeqW / seqLen), Math.max(1, rowH - 0.5));
                }
            }
        }

        // ── viewport highlight (blue) ──
        const selX = Math.floor(LABEL_WIDTH + startFrac * mmSeqW) + 0.5;
        const selW = Math.max(1, Math.floor((endFrac - startFrac) * mmSeqW));

        // dim areas outside selection
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.fillRect(LABEL_WIDTH, rowsTop, selX - LABEL_WIDTH - 0.5, rowAreaH);
        ctx.fillRect(selX + selW, rowsTop, availableWidth - (selX + selW), rowAreaH);

        // selection border (Sharp 1px via +0.5 offset)
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 1;
        ctx.strokeRect(selX, rowsTop, selW, rowAreaH);

        // selection fill
        ctx.fillStyle = 'rgba(59, 130, 246, 0.08)';
        ctx.fillRect(selX, rowsTop, selW, rowAreaH);

        // ── small bottom handle ──
        const handleColor = '#3b82f6';
        ctx.fillStyle = handleColor;

        // Ensure handle has minimum visual width (16px) so it is visible even if selection is 1px
        const minHandleW = 16;
        const handleDrawW = Math.max(selW, minHandleW);

        // Center the handle on the selection
        let handleX = selX + selW / 2 - handleDrawW / 2;

        // Clamp to minimap bounds so it doesn't leave the area
        handleX = Math.max(LABEL_WIDTH, Math.min(LABEL_WIDTH + mmSeqW - handleDrawW, handleX));

        // Draw handle rect crisp
        ctx.fillRect(Math.floor(handleX), rowsTop + rowAreaH, handleDrawW, MINIMAP_HANDLE_H - 1);

        // label divider
        ctx.fillStyle = '#cbd5e1';
        ctx.fillRect(LABEL_WIDTH - 1, 0, 1, MINIMAP_HEIGHT);
    }, [sequences, querySeq, seqLen, availableWidth, startFrac, endFrac, gcContent]);

    useEffect(() => { drawMinimap(); }, [drawMinimap]);

    /* ══════════════════════════════════════════════════════
       MINIMAP DRAG
       ══════════════════════════════════════════════════════ */
    const handleMinimapMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = minimapRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const mmSeqW = rect.width - LABEL_WIDTH;
        const mouseXFrac = (e.clientX - rect.left - LABEL_WIDTH) / mmSeqW;

        // Capture current viewport
        const curSeqAreaW = availableWidth - LABEL_WIDTH;
        const curTotalVW = curSeqAreaW / viewFraction;
        const curStart = scrollLeft / curTotalVW;
        const curEnd = curStart + viewFraction;
        const handleZone = 10 / mmSeqW; // 10px side handle zone

        let dragType: 'pan' | 'left' | 'right';

        // Check for center handle hit (widened zone if viewport is small)
        const center = (curStart + curEnd) / 2;

        // Minimum handle width in fraction of total width
        const minHandleWFrac = 40 / mmSeqW;

        // The effective handle width is roughly the larger of viewport width fraction or minHandleWFrac
        // If viewport is smaller than minHandleWFrac, we use minHandleWFrac for the hit zone
        const effectiveHandleWFrac = Math.max(curEnd - curStart, minHandleWFrac);

        // Because the handle is centered, the hit zone is center +/- half the effective width
        const isCenterHit = Math.abs(mouseXFrac - center) < effectiveHandleWFrac / 2;

        if (Math.abs(mouseXFrac - curStart) < handleZone && mouseXFrac < curEnd) {
            dragType = 'left';
        } else if (Math.abs(mouseXFrac - curEnd) < handleZone && mouseXFrac > curStart) {
            dragType = 'right';
        } else if ((mouseXFrac >= curStart && mouseXFrac <= curEnd) || isCenterHit) {
            dragType = 'pan';
        } else {
            // Click outside → jump viewport center, then pan
            const halfVF = viewFraction / 2;
            const jumpStart = Math.max(0, Math.min(1 - viewFraction, mouseXFrac - halfVF));
            const jumpSL = jumpStart * curTotalVW;
            setScrollLeft(jumpSL);
            targetScrollRef.current = jumpSL;
            dragType = 'pan';
            // Update origin for drag
            const startClientX = e.clientX;
            const onMove = makeMoveHandler('pan', startClientX, jumpStart, jumpStart + viewFraction, curSeqAreaW, mmSeqW);
            const onUp = () => {
                isDragging.current = false;
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            };
            isDragging.current = true;
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
            e.preventDefault();
            return;
        }

        const startClientX = e.clientX;
        const onMove = makeMoveHandler(dragType, startClientX, curStart, curEnd, curSeqAreaW, mmSeqW);
        const onUp = () => {
            isDragging.current = false;
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };
        isDragging.current = true;
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        e.preventDefault();
    }, [availableWidth, viewFraction, scrollLeft, seqAreaW]);

    const makeMoveHandler = useCallback((
        dragType: 'pan' | 'left' | 'right',
        startClientX: number,
        origStart: number,
        origEnd: number,
        curSeqAreaW: number,
        mmSeqW: number,
    ) => {
        return (ev: MouseEvent) => {
            const deltaFrac = (ev.clientX - startClientX) / mmSeqW;
            let newStart = origStart;
            let newEnd = origEnd;

            if (dragType === 'pan') {
                const shift = deltaFrac;
                newStart = origStart + shift;
                newEnd = origEnd + shift;
                const width = origEnd - origStart;
                if (newStart < 0) { newStart = 0; newEnd = width; }
                if (newEnd > 1) { newEnd = 1; newStart = 1 - width; }
            } else if (dragType === 'left') {
                newStart = Math.max(0, Math.min(origEnd - 0.005, origStart + deltaFrac));
            } else {
                newEnd = Math.min(1, Math.max(origStart + 0.005, origEnd + deltaFrac));
            }

            const newVF = Math.max(0.005, newEnd - newStart);
            const newTotalW = curSeqAreaW / newVF;
            const newSL = newStart * newTotalW;

            setViewFraction(newVF);
            setScrollLeft(newSL);
            targetScrollRef.current = newSL;
        };
    }, []);

    /* ── minimap cursor style ─────────────────────────── */
    const handleMinimapMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = minimapRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const mmSeqW = rect.width - LABEL_WIDTH;
        const mouseXFrac = (e.clientX - rect.left - LABEL_WIDTH) / mmSeqW;
        const curTotalVW = seqAreaW / viewFraction;
        const curStart = scrollLeft / curTotalVW;
        const curEnd = curStart + viewFraction;
        const handleZone = 10 / mmSeqW;

        if (Math.abs(mouseXFrac - curStart) < handleZone || Math.abs(mouseXFrac - curEnd) < handleZone) {
            canvas.style.cursor = 'ew-resize';
        } else if (mouseXFrac >= curStart && mouseXFrac <= curEnd) {
            canvas.style.cursor = 'grab';
        } else {
            canvas.style.cursor = 'pointer';
        }
    }, [seqAreaW, viewFraction, scrollLeft]);

    /* ══════════════════════════════════════════════════════
       MAIN CANVAS DRAWING
       ══════════════════════════════════════════════════════ */
    const draw = useCallback(() => {
        const cvs = canvasRef.current;
        if (!cvs || sequences.length === 0) return;
        const ctx = cvs.getContext('2d');
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        cvs.width = availableWidth * dpr;
        cvs.height = totalH * dpr;
        cvs.style.width = `${availableWidth}px`;
        cvs.style.height = `${totalH}px`;
        ctx.scale(dpr, dpr);

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, availableWidth, totalH);

        const firstCol = Math.max(0, Math.floor(scrollLeft / cellW));
        const lastCol = Math.min(seqLen - 1, Math.ceil((scrollLeft + seqAreaW) / cellW));

        /* ── clip sequence area so it never bleeds into labels ── */
        ctx.save();
        ctx.beginPath();
        ctx.rect(LABEL_WIDTH, 0, seqAreaW, totalH);
        ctx.clip();

        /* ── ruler ── */
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(LABEL_WIDTH, 0, seqAreaW, RULER_HEIGHT);
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(LABEL_WIDTH, RULER_HEIGHT - 0.5);
        ctx.lineTo(availableWidth, RULER_HEIGHT - 0.5);
        ctx.stroke();

        const tickInterval = cellW >= 4 ? 10 : cellW >= 1 ? 50 : 100;
        ctx.fillStyle = '#94a3b8';
        ctx.font = '9px ui-monospace, SFMono-Regular, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        for (let col = firstCol; col <= lastCol; col++) {
            if ((col + 1) % tickInterval === 0) {
                const x = LABEL_WIDTH + col * cellW - scrollLeft;
                ctx.fillStyle = '#cbd5e1';
                ctx.fillRect(x, RULER_HEIGHT - 6, 1, 6);
                ctx.fillStyle = '#94a3b8';
                ctx.fillText(String(col + 1), x, RULER_HEIGHT - 7);
            }
        }

        /* ── row contents (within clip) ── */
        for (let row = 0; row < sequences.length; row++) {
            const s = sequences[row];
            const y = RULER_HEIGHT + row * ROW_HEIGHT;
            const isQuery = row === 0;

            if (viewMode === 'letters') {
                for (let col = firstCol; col <= lastCol; col++) {
                    const ch = (s.seq[col] || '-').toUpperCase();
                    const x = LABEL_WIDTH + col * cellW - scrollLeft;
                    const c = NT_COLORS[ch] || { bg: '#fff', fg: '#374151' };
                    ctx.fillStyle = c.bg;
                    ctx.fillRect(x, y, cellW + 0.5, ROW_HEIGHT);
                    ctx.fillStyle = c.fg;
                    const fs = Math.min(13, Math.max(8, cellW * 0.8));
                    ctx.font = `${fs}px ui-monospace, SFMono-Regular, monospace`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(ch, x + cellW / 2, y + ROW_HEIGHT / 2);
                }
            } else {
                const sStart = seqStart(s.seq);
                const sEnd = seqEnd(s.seq);
                if (sStart <= sEnd) {
                    const barX1 = Math.max(LABEL_WIDTH, LABEL_WIDTH + sStart * cellW - scrollLeft);
                    const barX2 = Math.min(LABEL_WIDTH + seqAreaW, LABEL_WIDTH + (sEnd + 1) * cellW - scrollLeft);
                    if (barX2 > barX1) {
                        ctx.fillStyle = isQuery ? '#bfdbfe' : '#e2e8f0';
                        ctx.fillRect(barX1, y + 3, barX2 - barX1, ROW_HEIGHT - 6);
                    }
                }
                for (let col = firstCol; col <= lastCol; col++) {
                    const ch = (s.seq[col] || '-').toUpperCase();
                    const qch = (querySeq[col] || '-').toUpperCase();
                    if (ch === '-') continue;
                    if (ch !== qch && qch !== '-') {
                        const x = LABEL_WIDTH + col * cellW - scrollLeft;
                        ctx.fillStyle = '#dc2626';
                        ctx.fillRect(x, y + 2, Math.max(1, cellW), ROW_HEIGHT - 4);
                    }
                }
            }

            ctx.fillStyle = '#f1f5f9';
            ctx.fillRect(LABEL_WIDTH, y + ROW_HEIGHT - 0.5, seqAreaW, 0.5);
        }

        ctx.restore(); /* end clip */

        /* ── labels (drawn OUTSIDE clip so they’re never obscured) ── */
        for (let row = 0; row < sequences.length; row++) {
            const s = sequences[row];
            const y = RULER_HEIGHT + row * ROW_HEIGHT;
            const isQuery = row === 0;
            ctx.fillStyle = isQuery ? '#f0f9ff' : '#ffffff';
            ctx.fillRect(0, y, LABEL_WIDTH - 1, ROW_HEIGHT);
            ctx.fillStyle = isQuery ? '#0369a1' : '#475569';
            ctx.font = `${isQuery ? 'bold ' : ''}10px ui-monospace, SFMono-Regular, monospace`;
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            const lbl = s.id.length > 16 ? s.id.substring(0, 15) + '…' : s.id;
            ctx.fillText(lbl, LABEL_WIDTH - 6, y + ROW_HEIGHT / 2);
        }

        ctx.fillStyle = '#cbd5e1';
        ctx.fillRect(LABEL_WIDTH - 1, 0, 1, totalH);
    }, [sequences, querySeq, scrollLeft, cellW, seqAreaW, availableWidth, totalH, seqLen, viewMode]);

    useEffect(() => { draw(); }, [draw]);

    /* ── scroll handler ─────────────────────────────────── */
    const handleScroll = () => {
        if (!isDragging.current && scrollRef.current) {
            setScrollLeft(scrollRef.current.scrollLeft);
        }
    };

    /* ── Ctrl/⌘ + wheel = zoom ─────────────────────────── */
    const handleWheel = (e: React.WheelEvent) => {
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            const factor = e.deltaY > 0 ? 1.15 : 0.87;
            setViewFraction((p) => Math.max(0.005, Math.min(1, p * factor)));
        }
    };

    /* ── canvas click → copy sequence ─────────────────── */
    const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (viewMode !== 'letters') return;
        const cvs = canvasRef.current;
        if (!cvs) return;
        const rect = cvs.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const row = Math.floor((y - RULER_HEIGHT) / ROW_HEIGHT);
        if (row >= 0 && row < sequences.length) {
            copySequence(sequences[row]);
        }
    };

    if (!alignment || sequences.length === 0) return null;

    return (
        <div ref={containerRef} className="mt-6 border border-slate-200 rounded-xl shadow-sm overflow-hidden bg-white">
            {/* ── header ── */}
            <div className="px-5 py-3 bg-gradient-to-r from-slate-50 to-indigo-50/50 border-b border-slate-200 flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-3 flex-wrap">
                    <h2 className="text-lg font-semibold text-slate-800">
                        Alignment <span className="text-sm font-normal text-slate-500">({sequences.length} seq, {seqLen} bp)</span>
                    </h2>
                    <div className="flex items-center gap-1.5">
                        <button
                            onClick={copyAllFasta}
                            className="px-2 py-1 text-xs font-medium rounded-md border border-slate-300 text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors flex items-center gap-1"
                            title="Copy full alignment as FASTA"
                        >
                            <ClipboardIcon /> FASTA
                        </button>
                        <button
                            onClick={copySelection}
                            className="px-2 py-1 text-xs font-medium rounded-md border border-indigo-300 text-indigo-600 hover:bg-indigo-50 transition-colors flex items-center gap-1"
                            title={`Copy visible selection (pos ${startCol + 1}–${endCol + 1})`}
                        >
                            <ClipboardIcon /> {startCol + 1}–{endCol + 1}
                        </button>
                    </div>
                    {copyFeedback && (
                        <span className="text-xs text-emerald-600 font-medium animate-pulse">{copyFeedback}</span>
                    )}
                </div>
                <div className="flex items-center gap-3">
                    <div className="flex rounded-md overflow-hidden border border-slate-300">
                        <button
                            onClick={() => { setViewMode('bars'); setViewFraction(1); setScrollLeft(0); targetScrollRef.current = 0; }}
                            className={`px-3 py-1 text-xs font-medium transition-colors ${viewMode === 'bars'
                                ? 'bg-indigo-500 text-white'
                                : 'bg-white text-slate-600 hover:bg-slate-50'
                                }`}
                        >
                            Overview
                        </button>
                        <button
                            onClick={() => {
                                setViewMode('letters');
                                const vf = Math.min(1, (BP_THRESHOLD - HYSTERESIS - 1) / seqLen);
                                setViewFraction(vf);
                                setScrollLeft(0);
                                targetScrollRef.current = 0;
                            }}
                            className={`px-3 py-1 text-xs font-medium transition-colors border-l border-slate-300 ${viewMode === 'letters'
                                ? 'bg-indigo-500 text-white'
                                : 'bg-white text-slate-600 hover:bg-slate-50'
                                }`}
                        >
                            Sequence
                        </button>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <button
                            onClick={zoomOut}
                            className="w-6 h-6 flex items-center justify-center rounded border border-slate-300 text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors text-sm font-bold"
                            title="Zoom out"
                        >−</button>
                        <input
                            type="range"
                            min={0.005}
                            max={1}
                            step={0.005}
                            value={viewFraction}
                            onChange={(e) => setViewFraction(parseFloat(e.target.value))}
                            className="w-24 h-1.5 accent-indigo-500"
                            style={{ direction: 'rtl' }}
                        />
                        <button
                            onClick={zoomIn}
                            className="w-6 h-6 flex items-center justify-center rounded border border-slate-300 text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors text-sm font-bold"
                            title="Zoom in"
                        >+</button>
                    </div>
                    <span className="text-xs text-slate-400 font-mono w-12 text-right">{Math.round(visibleBases)} bp</span>
                </div>
            </div>

            {/* ── minimap navigator ── */}
            <div className="border-b border-slate-200 bg-slate-50">
                <canvas
                    ref={minimapRef}
                    style={{ display: 'block', cursor: 'grab' }}
                    onMouseDown={handleMinimapMouseDown}
                    onMouseMove={handleMinimapMouseMove}
                />
            </div>

            {/* ── legend ── */}
            <div className="px-5 py-1.5 border-b border-slate-100 bg-white flex items-center gap-4 text-xs text-slate-500">
                {viewMode === 'letters' ? (
                    <>
                        {Object.entries({ A: '#fee2e2', T: '#dbeafe', G: '#fef9c3', C: '#dcfce7' }).map(
                            ([nt, bg]) => (
                                <span key={nt} className="flex items-center gap-1">
                                    <span className="inline-block w-3 h-3 rounded-sm" style={{ background: bg }} />{nt}
                                </span>
                            ),
                        )}
                        <span className="flex items-center gap-1">
                            <span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#f3f4f6' }} />Gap
                        </span>
                        <span className="ml-auto italic text-slate-400">Click a row to copy its sequence</span>
                    </>
                ) : (
                    <>
                        <span className="flex items-center gap-1">
                            <span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#e2e8f0' }} />
                            Sequence
                        </span>
                        <span className="flex items-center gap-1">
                            <span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#dc2626' }} />
                            Mismatch vs query
                        </span>
                        <span className="ml-auto italic">Ctrl/⌘ + scroll to zoom · Drag minimap to navigate</span>
                    </>
                )}
            </div>

            {/* ── scrollable canvas area ── */}
            <div
                ref={scrollRef}
                className="overflow-x-auto overflow-y-auto"
                style={{ height: `${VIEWER_HEIGHT}px` }}
                onScroll={handleScroll}
                onWheel={handleWheel}
            >
                <div style={{ width: `${LABEL_WIDTH + totalVirtualW}px`, height: '1px' }} />
                <canvas
                    ref={canvasRef}
                    style={{ display: 'block', position: 'sticky', top: 0, left: 0, cursor: viewMode === 'letters' ? 'pointer' : 'default' }}
                    onClick={handleCanvasClick}
                />
            </div>

            {/* ── selection stats footer ── */}
            {selectionStats && (
                <div className="bg-slate-50 border-t border-slate-200 px-5 py-2 text-xs text-slate-600 font-mono flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <span className="font-semibold text-slate-700">Visible Range: {startCol + 1}–{endCol + 1}</span>
                        <span>Length: {selectionStats.total} bp</span>
                        <span className="text-emerald-700 font-medium">GC: {selectionStats.gcPct.toFixed(1)}%</span>
                    </div>
                    <div className="flex items-center gap-3 text-slate-500">
                        <span>A: {selectionStats.a}</span>
                        <span>T: {selectionStats.t}</span>
                        <span>G: {selectionStats.g}</span>
                        <span>C: {selectionStats.c}</span>
                    </div>
                </div>
            )}
        </div>
    );
};

/* ── small clipboard icon component ── */
const ClipboardIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
        <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
        <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" />
    </svg>
);

/* ── helpers ── */
function seqStart(seq: string): number {
    for (let i = 0; i < seq.length; i++) if (seq[i] !== '-') return i;
    return 0;
}
function seqEnd(seq: string): number {
    for (let i = seq.length - 1; i >= 0; i--) if (seq[i] !== '-') return i;
    return seq.length - 1;
}

export default MSAViewer;

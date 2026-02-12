import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';

export interface ParsedSequence {
    id: string;
    seq: string;
}

interface MSAViewerProps {
    alignment: string;
    onVisibleQueryChange?: (data: { id: string; seq: string; start: number; end: number }) => void;
    jobName?: string;
    primers?: { p1: { start: number, end: number }, p2: { start: number, end: number } } | null;
}

/* ── constants ────────────────────────────────────────── */
const LABEL_WIDTH = 140;
const RULER_HEIGHT = 24;
const ROW_HEIGHT = 18;
const MAX_VIEWER_HEIGHT = 500;
const BP_THRESHOLD = 100;
const HYSTERESIS = 15;
const MINIMAP_GC_H = 40;
const MINIMAP_RULER_H = 14;
const MINIMAP_HANDLE_H = 8;
const MINIMAP_HEIGHT = MINIMAP_GC_H + MINIMAP_RULER_H + 50 + MINIMAP_HANDLE_H;

const MSAViewer: React.FC<MSAViewerProps> = ({ alignment, onVisibleQueryChange, jobName, primers }) => {
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
    const [selectionRange, setSelectionRange] = useState<{ start: number; end: number } | null>(null);

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

    /* ── broadcast visible query range ─────────────────── */
    useEffect(() => {
        if (sequences.length > 0 && onVisibleQueryChange) {
            // Provide the visible slice of the query (first sequence)
            const query = sequences[0];
            const start = Math.max(0, startCol);
            const end = Math.min(query.seq.length - 1, endCol);
            const slice = query.seq.slice(start, end + 1);
            onVisibleQueryChange({
                id: query.id,
                seq: slice,
                start: start,
                end: end
            });
        }
    }, [sequences, startCol, endCol, onVisibleQueryChange]);

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

                const x = LABEL_WIDTH + (col / seqLen) * mmSeqW;
                const w = Math.max(1, mmSeqW / seqLen);
                const h = Math.max(1, rowH - 0.5);

                // Violet for:
                // 1) Insertion vs Query (qch == '-')
                // 2) Internal Deletion (ch == '-' inside start/end)
                const isInternalDeletion = !isQuery && ch === '-' && col >= sStart && col <= sEnd;
                const isInsertion = !isQuery && qch === '-' && ch !== '-';

                if (isInternalDeletion || isInsertion) {
                    ctx.fillStyle = '#9333ea';
                    ctx.fillRect(x, y, w, h);
                } else if (!isQuery && ch !== '-' && ch !== qch && qch !== '-') {
                    // Mismatch vs Query (Red)
                    ctx.fillStyle = '#dc2626';
                    ctx.fillRect(x, y, w, h);
                }
            }
        }

        // ── viewport highlight (blue) or selection (green) ──

        // 1) Draw Selection (Green) if active
        if (selectionRange) {
            const s = Math.min(selectionRange.start, selectionRange.end);
            const e = Math.max(selectionRange.start, selectionRange.end);
            const selX = Math.floor(LABEL_WIDTH + s * mmSeqW) + 0.5;
            const selW = Math.max(1, Math.floor((e - s) * mmSeqW));

            ctx.fillStyle = 'rgba(74, 222, 128, 0.4)'; // Pastel Green
            ctx.fillRect(selX, rowsTop, selW, rowAreaH);

            ctx.strokeStyle = '#22c55e'; // Green border
            ctx.lineWidth = 1;
            ctx.strokeRect(selX, rowsTop, selW, rowAreaH);
        }

        // 2) Draw Viewport (Blue) ONLY if zoomed in (viewFraction < 0.99)
        // If we are fully zoomed out, we hide the blue box as requested.
        if (viewFraction < 0.99) {
            const selX = Math.floor(LABEL_WIDTH + startFrac * mmSeqW) + 0.5;
            const selW = Math.max(1, Math.floor((endFrac - startFrac) * mmSeqW));

            // dim areas outside viewport (only if NO selection is ongoing, for clarity?)
            // actually, standard minimap dims outside viewport usually.
            // But user said "User would see just the empty bar".
            // Let's keep the dimming only if blue box is visible, or maybe always?
            // "User would see just the empty bar" suggests NO dimming initially either.
            // So if > 0.99, we draw nothing extra.

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
        }

        // 2.5) Draw Primers (P1=Green, P2=Blue) on Query Row (row 0)
        if (primers) {
            const y = rowsTop; // Query is row 0
            const h = Math.max(1, rowH - 0.5);

            // P1
            const p1x = LABEL_WIDTH + (primers.p1.start / seqLen) * mmSeqW;
            const p1w = Math.max(1, ((primers.p1.end - primers.p1.start) / seqLen) * mmSeqW);
            ctx.fillStyle = '#22c55e'; // Green
            ctx.fillRect(p1x, y, p1w, h); // Fill

            // P2
            const p2x = LABEL_WIDTH + (primers.p2.start / seqLen) * mmSeqW;
            const p2w = Math.max(1, ((primers.p2.end - primers.p2.start) / seqLen) * mmSeqW);
            ctx.fillStyle = '#3b82f6'; // Blue
            ctx.fillRect(p2x, y, p2w, h);
        }

        // label divider
        ctx.fillStyle = '#cbd5e1';
        ctx.fillRect(LABEL_WIDTH - 1, 0, 1, MINIMAP_HEIGHT);
    }, [sequences, querySeq, seqLen, availableWidth, startFrac, endFrac, gcContent, viewFraction, selectionRange, primers]);

    useEffect(() => { drawMinimap(); }, [drawMinimap]);

    /* ══════════════════════════════════════════════════════
       MINIMAP DRAG
       ══════════════════════════════════════════════════════ */
    const handleMinimapMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = minimapRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const mmSeqW = rect.width - LABEL_WIDTH;
        const mouseXFrac = Math.max(0, Math.min(1, (e.clientX - rect.left - LABEL_WIDTH) / mmSeqW));

        // Capture current viewport
        const curSeqAreaW = availableWidth - LABEL_WIDTH;
        // const curTotalVW = curSeqAreaW / viewFraction; // unused in select mode
        const curStart = scrollLeft / (curSeqAreaW / viewFraction);
        const curEnd = curStart + viewFraction;
        const handleZone = 10 / mmSeqW; // 10px side handle zone

        let dragType: 'select' | 'left' | 'right';

        // Check for handles ONLY if blue box is visible
        const blueBoxVisible = viewFraction < 0.99;

        if (blueBoxVisible) {
            if (Math.abs(mouseXFrac - curStart) < handleZone && mouseXFrac < curEnd) {
                dragType = 'left';
            } else if (Math.abs(mouseXFrac - curEnd) < handleZone && mouseXFrac > curStart) {
                dragType = 'right';
            } else {
                dragType = 'select';
            }
        } else {
            dragType = 'select';
        }

        if (dragType === 'select') {
            // Init selection
            setSelectionRange({ start: mouseXFrac, end: mouseXFrac });
            // No need to set scroll/view yet
        }

        const startClientX = e.clientX;
        const onMove = makeMoveHandler(dragType, startClientX, curStart, curEnd, curSeqAreaW, mmSeqW, mouseXFrac);

        const onUp = () => {
            isDragging.current = false;
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);

            // Finalize selection logic
            if (dragType === 'select') {
                setSelectionRange((prev) => {
                    if (!prev) return null;
                    const s = Math.min(prev.start, prev.end);
                    const e = Math.max(prev.start, prev.end);
                    // If selection is tiny (click), maybe just ignore or zoom in a bit?
                    // Let's enforce a minimum 0.5% width to avoid accidental clicks
                    if (e - s < 0.005) {
                        return null; // Cancel
                    }

                    // Apply zoom
                    const newVF = e - s;
                    const newTotalW = curSeqAreaW / newVF;
                    const newSL = s * newTotalW;

                    setViewFraction(newVF);
                    setScrollLeft(newSL);
                    targetScrollRef.current = newSL;

                    return null; // Clear selection rectangle
                });
            }
        };
        isDragging.current = true;
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        e.preventDefault();
    }, [availableWidth, viewFraction, scrollLeft, seqAreaW]);

    const makeMoveHandler = useCallback((
        dragType: 'select' | 'left' | 'right',
        startClientX: number,
        origStart: number,
        origEnd: number,
        curSeqAreaW: number,
        mmSeqW: number,
        origMouseFrac: number
    ) => {
        return (ev: MouseEvent) => {
            const deltaFrac = (ev.clientX - startClientX) / mmSeqW;

            if (dragType === 'select') {
                const currentMouseFrac = Math.max(0, Math.min(1, origMouseFrac + deltaFrac));
                setSelectionRange({ start: origMouseFrac, end: currentMouseFrac });
                return;
            }

            // Standard Resize Logic
            let newStart = origStart;
            let newEnd = origEnd;

            if (dragType === 'left') {
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

        const curSeqAreaW = availableWidth - LABEL_WIDTH;
        const curTotalVW = curSeqAreaW / viewFraction;
        const curStart = scrollLeft / curTotalVW;
        const curEnd = curStart + viewFraction;
        const handleZone = 10 / mmSeqW;

        const blueBoxVisible = viewFraction < 0.99;

        if (blueBoxVisible) {
            if (Math.abs(mouseXFrac - curStart) < handleZone || Math.abs(mouseXFrac - curEnd) < handleZone) {
                canvas.style.cursor = 'ew-resize';
            } else {
                canvas.style.cursor = 'crosshair'; // Selecting is default inside or out
            }
        } else {
            canvas.style.cursor = 'crosshair'; // Always selecting if full view
        }
    }, [seqAreaW, viewFraction, scrollLeft, availableWidth]);

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

            const sStart = seqStart(s.seq);
            const sEnd = seqEnd(s.seq);

            if (viewMode === 'letters') {
                for (let col = firstCol; col <= lastCol; col++) {
                    const ch = (s.seq[col] || '-').toUpperCase();
                    const qch = (querySeq[col] || '-').toUpperCase();

                    const x = LABEL_WIDTH + col * cellW - scrollLeft;

                    let bg = '#f3f4f6'; // default/match gray
                    let fg = '#374151';

                    // Determine sequence boundaries for internal/external gap logic
                    // We can optimize by calculating sStart/sEnd outside the loop if needed, 
                    // but doing it per row is fine (seqStart is fast).
                    // Actually, let's hoist it out of the column loop for the row.

                    // (Hoisted above loop)

                    if (ch === '-') {
                        if (!isQuery && col >= sStart && col <= sEnd) {
                            // Internal Deletion (Violet)
                            bg = '#f3e8ff';
                            fg = '#7e22ce';
                        } else {
                            // External Deletion (Gray)
                            bg = '#f3f4f6';
                            fg = '#9ca3af';
                        }
                    } else if (!isQuery && qch === '-' && ch !== '-') {
                        // Insertion vs Query (Violet)
                        bg = '#f3e8ff';
                        fg = '#7e22ce';
                    } else if (!isQuery && ch !== qch && qch !== '-') {
                        // Mismatch (Red)
                        bg = '#fee2e2';
                        fg = '#b91c1c';
                    } else {
                        // Match or Query
                        bg = '#f3f4f6';
                        fg = '#374151';

                        // Check for Primers on Query
                        if (isQuery && primers) {
                            if (col >= primers.p1.start && col < primers.p1.end) {
                                bg = '#bbf7d0'; // Green-200
                                fg = '#14532d'; // Green-900
                            } else if (col >= primers.p2.start && col < primers.p2.end) {
                                bg = '#bfdbfe'; // Blue-200
                                fg = '#1e3a8a'; // Blue-900
                            }
                        }
                    }

                    ctx.fillStyle = bg;
                    ctx.fillRect(x, y, cellW + 0.5, ROW_HEIGHT);
                    ctx.fillStyle = fg;
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

                    const x = LABEL_WIDTH + col * cellW - scrollLeft;

                    const isInternalDeletion = !isQuery && ch === '-' && col >= sStart && col <= sEnd;
                    const isInsertion = !isQuery && qch === '-' && ch !== '-';

                    if (isInternalDeletion || isInsertion) {
                        // Violet (Stronger for bars)
                        ctx.fillStyle = '#9333ea';
                        ctx.fillRect(x, y + 2, Math.max(1, cellW), ROW_HEIGHT - 4);
                    } else if (!isQuery && ch !== '-' && ch !== qch && qch !== '-') {
                        // Mismatch vs Query (Red)
                        ctx.fillStyle = '#dc2626';
                        ctx.fillRect(x, y + 2, Math.max(1, cellW), ROW_HEIGHT - 4);
                    } else if (isQuery && primers && ch !== '-') {
                        // Highlight Primers on Query
                        if (col >= primers.p1.start && col < primers.p1.end) {
                            ctx.fillStyle = '#22c55e'; // Green
                            ctx.fillRect(x, y + 2, Math.max(1, cellW), ROW_HEIGHT - 4);
                        } else if (col >= primers.p2.start && col < primers.p2.end) {
                            ctx.fillStyle = '#3b82f6'; // Blue
                            ctx.fillRect(x, y + 2, Math.max(1, cellW), ROW_HEIGHT - 4);
                        }
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
    }, [sequences, querySeq, scrollLeft, cellW, seqAreaW, availableWidth, totalH, seqLen, viewMode, primers]);

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

            // Calculate mouse position relative to the sequence view
            const rect = scrollRef.current?.getBoundingClientRect();
            if (!rect) return;

            const offsetX = e.clientX - rect.left - LABEL_WIDTH;
            const seqAreaWidth = rect.width - LABEL_WIDTH; // Should match seqAreaW effectively

            // If mouse is over labels, just zoom center or left? Let's assume clamping to 0 if < 0.
            const validOffsetX = Math.max(0, Math.min(seqAreaWidth, offsetX));

            // Current global fraction under mouse
            const currentTotalVirtualW = seqAreaWidth / viewFraction;
            const mouseFracGlobal = (scrollLeft + validOffsetX) / currentTotalVirtualW;

            // Apply new zoom
            const newVF = Math.max(0.005, Math.min(1, viewFraction * factor));

            // Calculate new ScrollLeft to keep mouseFracGlobal at validOffsetX
            const newTotalVirtualW = seqAreaWidth / newVF;
            let newSL = mouseFracGlobal * newTotalVirtualW - validOffsetX;

            // Clamp scroll
            newSL = Math.max(0, Math.min(newTotalVirtualW - seqAreaWidth, newSL));

            setViewFraction(newVF);
            setScrollLeft(newSL);

            // Sync with ref if needed, though we updated state directly
            if (scrollRef.current) scrollRef.current.scrollLeft = newSL;
        }
    };

    /* ── canvas click → copy sequence ─────────────────── */
    /* ── canvas click → copy sequence OR select ─────────────────── */
    const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
        // If we are in letters mode, we might still want to select? 
        // Actually, user wants "only the query sequence of choice will be displayed".
        // Let's make click always select the row.

        const cvs = canvasRef.current;
        if (!cvs) return;
        const rect = cvs.getBoundingClientRect();
        const y = e.clientY - rect.top;
        const row = Math.floor((y - RULER_HEIGHT) / ROW_HEIGHT);

        if (row >= 0 && row < sequences.length) {
            const seq = sequences[row];
            if (viewMode === 'letters') {
                copySequence(seq);
            }
        }
    };

    if (!alignment || sequences.length === 0) return null;

    return (
        <div ref={containerRef} className="mt-6 border border-slate-200 rounded-xl shadow-sm overflow-hidden bg-white">
            {/* ── header ── */}
            <div className="px-5 py-3 bg-gradient-to-r from-slate-50 to-indigo-50/50 border-b border-slate-200 flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-3 flex-wrap">
                    <h2 className="text-lg font-semibold text-slate-800">
                        Multiple sequence alignment <span className="text-sm font-normal text-slate-500">({sequences.length} seq, {seqLen} bp)</span>
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
                    <span className="text-xs text-slate-400 font-mono w-20 text-right">{Math.round(visibleBases)} bp</span>
                </div>
            </div>

            {/* ── minimap navigator ── */}
            <div className="border-b border-slate-200 bg-slate-50">
                <canvas
                    ref={minimapRef}
                    style={{ display: 'block', cursor: 'crosshair' }}
                    onMouseDown={handleMinimapMouseDown}
                    onMouseMove={handleMinimapMouseMove}
                />
            </div>

            {/* ── legend ── */}
            <div className="px-5 py-1.5 border-b border-slate-100 bg-white flex items-center gap-4 text-xs text-slate-500">
                <span className="flex items-center gap-1">
                    <span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#f3f4f6' }} />
                    Sequence / Match
                </span>
                <span className="flex items-center gap-1">
                    <span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#fee2e2' }} />
                    Mismatch
                </span>
                <span className="flex items-center gap-1">
                    <span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#9333ea' }} />
                    Insertion / Deletion
                </span>
                <span className="ml-auto italic text-slate-400">
                    {viewMode === 'letters' ? 'Click a row to copy' : 'Drag minimap to zoom/select · Ctrl/⌘ + scroll to zoom'}
                </span>
            </div>

            {/* ── scrollable canvas area ── */}
            <div
                ref={scrollRef}
                className="overflow-x-auto overflow-y-auto overscroll-contain"
                style={{ height: `${Math.min(totalH, MAX_VIEWER_HEIGHT)}px` }}
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
            {
                selectionStats && (
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
                )
            }
        </div >
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

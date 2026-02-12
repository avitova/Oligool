
export function reverseComplement(seq: string): string {
    const complement: { [key: string]: string } = {
        'A': 'T', 'T': 'A', 'U': 'A',
        'C': 'G', 'G': 'C',
        'N': 'N', '-': '-',
        'a': 't', 't': 'a', 'u': 'a',
        'c': 'g', 'g': 'c',
        'n': 'n'
    };
    return seq.split('').reverse().map(c => complement[c] || c).join('');
}

export function calculateTm(seq: string): number {
    // Simple Breslauer/SantaLucia approx or simpler 4+2 for short?
    // Using simple formula for UI for now:
    // Tm = 64.9 + 41 * (G+C - 16.4) / N
    const s = seq.toUpperCase();
    const g = (s.match(/G/g) || []).length;
    const c = (s.match(/C/g) || []).length;
    const n = s.length;
    if (n === 0) return 0;
    return 64.9 + 41 * (g + c - 16.4) / n;
}

export function calculateSimpleTm(seq: string): number {
    const s = seq.toUpperCase();
    const g = (s.match(/G/g) || []).length;
    const c = (s.match(/C/g) || []).length;
    const a = (s.match(/A/g) || []).length;
    const t = (s.match(/T/g) || []).length;
    if (seq.length < 14) {
        return (a + t) * 2 + (g + c) * 4;
    }
    return 64.9 + 41 * (g + c - 16.4) / seq.length;
}

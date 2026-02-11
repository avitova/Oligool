import { useState } from 'react';
import MSAViewer from './components/MSAViewer';
import BlastResults from './components/BlastResults';

type Step = 'input' | 'blasting' | 'aligning' | 'done';

interface BlastHit {
  accession: string;
  description: string;
  evalue: number;
  identity: number;
  query_cover: number;
}

function App() {
  const [input, setInput] = useState('');
  const [step, setStep] = useState<Step>('input');
  const [blastHits, setBlastHits] = useState<BlastHit[]>([]);
  const [blastMeta, setBlastMeta] = useState<{ rid: string; rtoe: number; query_len: number } | null>(null);
  const [alignment, setAlignment] = useState('');
  const [error, setError] = useState('');
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('ncbi_api_key') || '');
  const [showSettings, setShowSettings] = useState(!localStorage.getItem('ncbi_api_key'));
  const [maxHitsPreset, setMaxHitsPreset] = useState('50');
  const [customHits, setCustomHits] = useState('');
  const [organism, setOrganism] = useState('');
  const [eValue, setEValue] = useState('0.05');
  const [percIdentity, setPercIdentity] = useState('0');

  const maxHits = maxHitsPreset === 'custom'
    ? parseInt(customHits, 10) || 50
    : maxHitsPreset === 'all' ? 5000 : parseInt(maxHitsPreset, 10);

  const handleApiKeyChange = (val: string) => {
    setApiKey(val);
    if (val.trim()) {
      localStorage.setItem('ncbi_api_key', val.trim());
    } else {
      localStorage.removeItem('ncbi_api_key');
    }
  };

  const steps: { key: Step; label: string }[] = [
    { key: 'input', label: 'Input Sequence' },
    { key: 'blasting', label: 'BLAST Search' },
    { key: 'aligning', label: 'MSA Alignment' },
    { key: 'done', label: 'Results' },
  ];

  const stepOrder = ['input', 'blasting', 'aligning', 'done'];

  const handleSearch = async () => {
    setStep('blasting');
    setError('');
    setBlastHits([]);
    setBlastMeta(null);
    setAlignment('');

    try {
      // Parse: if it's FASTA, extract the sequence; otherwise use raw text
      let sequence = input.trim();
      if (!sequence) {
        throw new Error('Please enter a sequence.');
      }

      const response = await fetch('http://localhost:8000/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sequence,
          max_hits: maxHits,
          api_key: apiKey.trim(),
          organism: organism.trim() || undefined,
          e_value: parseFloat(eValue) || undefined,
          perc_identity: parseFloat(percIdentity) || undefined,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Search failed');
      }

      const data = await response.json();
      setBlastHits(data.blast_hits);
      setBlastMeta(data.blast_meta);
      setStep('aligning');

      // Small delay so the user sees the step change
      await new Promise((r) => setTimeout(r, 300));
      setAlignment(data.alignment);
      setStep('done');
    } catch (err: any) {
      setError(err.message);
      setStep('input');
    }
  };

  const handleReset = () => {
    setStep('input');
    setBlastHits([]);
    setBlastMeta(null);
    setAlignment('');
    setError('');
    setInput('');
  };

  const isStepActive = (s: Step) => stepOrder.indexOf(s) <= stepOrder.indexOf(step);
  const isStepCurrent = (s: Step) => s === step;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-50/30 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <header className="mb-8 flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
              Oligool
            </h1>
            <p className="mt-1 text-slate-500">BLAST Search → Multiple Sequence Alignment</p>
          </div>
          <button
            onClick={() => setShowSettings((v) => !v)}
            className={`mt-1.5 p-2 rounded-lg border transition-colors ${showSettings
              ? 'bg-indigo-50 border-indigo-200 text-indigo-600'
              : 'bg-white border-slate-200 text-slate-400 hover:text-slate-600 hover:border-slate-300'
              }`}
            title="NCBI Settings"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
            </svg>
          </button>
        </header>

        {/* NCBI API Key Settings */}
        {showSettings && (
          <div className="mb-6 bg-white border border-slate-200 rounded-xl shadow-sm p-4">
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium text-slate-700 whitespace-nowrap">
                NCBI API Key
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => handleApiKeyChange(e.target.value)}
                placeholder="Enter your NCBI API key for faster searches"
                className="flex-1 rounded-lg border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-sm p-2 border font-mono"
              />
              {apiKey && (
                <span className="text-xs text-emerald-600 font-medium flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
                  Saved
                </span>
              )}
            </div>
            <p className="mt-2 text-xs text-slate-400">
              Get a free API key from{' '}
              <a
                href="https://www.ncbi.nlm.nih.gov/account/settings/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-indigo-500 hover:text-indigo-600 underline"
              >
                NCBI Account Settings
              </a>
              {' '}→ API Key Management. This increases your BLAST rate limit from 3 to 10 req/s and improves queue priority.
            </p>
          </div>
        )}

        {/* Progress Stepper */}
        <div className="mb-8">
          <div className="flex items-center justify-between max-w-2xl relative">
            {steps.map((s, idx) => (
              <div key={s.key} className="flex items-center">
                <div className="flex flex-col items-center">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-all duration-300 ${isStepCurrent(s.key)
                      ? 'bg-indigo-600 text-white ring-4 ring-indigo-100'
                      : isStepActive(s.key)
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-200 text-slate-500'
                      }`}
                  >
                    {isStepActive(s.key) && !isStepCurrent(s.key) ? '✓' : idx + 1}
                  </div>
                  <span
                    className={`mt-1.5 text-xs font-medium ${isStepActive(s.key) ? 'text-indigo-600' : 'text-slate-400'
                      }`}
                  >
                    {s.label}
                  </span>
                </div>
                {idx < steps.length - 1 && (
                  <div
                    className={`w-16 sm:w-24 h-0.5 mx-2 transition-colors duration-300 ${stepOrder.indexOf(step) > idx ? 'bg-indigo-400' : 'bg-slate-200'
                      }`}
                  />
                )}
              </div>
            ))}

            {/* Logo positioned to the right of the "Results" bubble */}
            <img
              src="/rabbit_oligool.png"
              alt="Oligool Logo"
              className={`absolute h-96 w-auto object-contain z-10 pointer-events-none hidden lg:block opacity-90 transition-all duration-500 ${step === 'done'
                ? 'top-[-158px] left-[calc(100%+40px)]'
                : 'top-[-178px] left-[calc(100%+40px)]'
                }`}
            />
          </div>
        </div>

        <main>
          {/* Input Area */}
          <div className={`bg-white shadow-sm rounded-xl border border-slate-200 p-6 mb-6 transition-all duration-300 ${step === 'done' ? 'hidden' : 'block'}`}>
            <label htmlFor="sequence" className="block text-sm font-semibold text-slate-700 mb-2">
              Query Sequence
              <span className="ml-2 font-normal text-slate-400">(FASTA or raw sequence)</span>
            </label>
            <textarea
              id="sequence"
              rows={8}
              disabled={step !== 'input'}
              className="w-full rounded-lg border-slate-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 font-mono text-sm p-3 border disabled:opacity-50 disabled:bg-slate-50"
              placeholder={">my_sequence\nATCGATCGATCGATCGATCGATCGATCG..."}
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4 border-t border-slate-100 pt-4">
              {/* Organism Filter */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Organism (Optional)</label>
                <input
                  type="text"
                  value={organism}
                  onChange={(e) => setOrganism(e.target.value)}
                  disabled={step !== 'input'}
                  placeholder="e.g. human, mouse, txid9606"
                  className="w-full rounded-lg border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-indigo-500 disabled:opacity-50 placeholder-slate-400 border"
                />
              </div>

              {/* E-value Threshold */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">E-value Threshold</label>
                <input
                  type="number"
                  step="1e-10"
                  min="0"
                  value={eValue}
                  onChange={(e) => setEValue(e.target.value)}
                  disabled={step !== 'input'}
                  className="w-full rounded-lg border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-indigo-500 disabled:opacity-50 border"
                />
              </div>

              {/* % Identity Threshold */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">% Identity Threshold</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={percIdentity}
                  onChange={(e) => setPercIdentity(e.target.value)}
                  disabled={step !== 'input'}
                  className="w-full rounded-lg border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-indigo-500 disabled:opacity-50 border"
                />
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between flex-wrap gap-3 pt-2">
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-slate-500">Max hits:</label>
                <div className="flex rounded-lg overflow-hidden border border-slate-300">
                  {[
                    { value: 'all', label: 'All' },
                    { value: '1000', label: '1000' },
                    { value: '500', label: '500' },
                    { value: '100', label: '100' },
                    { value: '50', label: '50' },
                    { value: '10', label: '10' },
                    { value: 'custom', label: '#' },
                  ].map((opt, i) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setMaxHitsPreset(opt.value)}
                      disabled={step !== 'input'}
                      className={`px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${i > 0 ? 'border-l border-slate-300' : ''
                        } ${maxHitsPreset === opt.value
                          ? 'bg-indigo-500 text-white'
                          : 'bg-white text-slate-600 hover:bg-slate-50'
                        }`}
                      title={opt.value === 'custom' ? 'Custom number' : opt.value === 'all' ? 'Up to 5000' : `Top ${opt.label}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <div
                  className={`overflow-hidden transition-all duration-300 ease-out flex items-center ${maxHitsPreset === 'custom' ? 'w-24 ml-2 opacity-100' : 'w-0 ml-0 opacity-0'
                    }`}
                >
                  <input
                    type="number"
                    min={1}
                    max={5000}
                    value={customHits}
                    onChange={(e) => setCustomHits(e.target.value)}
                    disabled={step !== 'input'}
                    placeholder="e.g. 200"
                    className="w-full rounded-lg border border-slate-300 px-2 py-1 text-xs font-mono focus:border-indigo-500 focus:ring-indigo-500 disabled:opacity-50 placeholder-slate-400"
                  />
                </div>
              </div>
              <div className="flex gap-3">
                {step !== 'input' && (
                  <button
                    onClick={handleReset}
                    className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50 transition-colors"
                  >
                    Reset
                  </button>
                )}
                <button
                  onClick={handleSearch}
                  disabled={step !== 'input' || !input.trim()}
                  className={`px-5 py-2 text-sm font-medium rounded-lg shadow-sm text-white transition-all duration-200 ${step !== 'input' || !input.trim()
                    ? 'bg-slate-300 cursor-not-allowed'
                    : 'bg-indigo-600 hover:bg-indigo-700 hover:shadow-md'
                    }`}
                >
                  Search &amp; Align
                </button>
              </div>
            </div>
          </div>

          {/* Loading states */}
          {step === 'blasting' && (
            <div className="bg-white shadow-sm rounded-xl border border-slate-200 p-8 mb-6 text-center">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-2 border-indigo-600 border-t-transparent mb-3"></div>
              <p className="text-slate-600 font-medium">Running BLAST search against NCBI...</p>
              <p className="text-sm text-slate-400 mt-1">This may take 30–120 seconds depending on NCBI server load.</p>
            </div>
          )}

          {step === 'aligning' && (
            <div className="bg-white shadow-sm rounded-xl border border-slate-200 p-8 mb-6 text-center">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-2 border-purple-600 border-t-transparent mb-3"></div>
              <p className="text-slate-600 font-medium">Running MAFFT alignment on {blastHits.length} sequences...</p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="rounded-xl bg-red-50 border border-red-200 p-4 mb-6">
              <div className="flex items-start">
                <span className="text-red-500 mr-3 text-lg">⚠</span>
                <div>
                  <h3 className="text-sm font-semibold text-red-800">Error</h3>
                  <p className="mt-1 text-sm text-red-700">{error}</p>
                </div>
              </div>
            </div>
          )}

          {/* Results Summary & Actions */}
          {step === 'done' && blastMeta && (
            <div className="mb-6 bg-white shadow-sm rounded-xl border border-slate-200 p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                  Search Completed
                </h3>
                <div className="mt-1 text-xs text-slate-500 font-mono flex flex-wrap gap-x-4 gap-y-1">
                  <span>RID: <span className="text-slate-700">{blastMeta.rid}</span></span>
                  <span>Len: <span className="text-slate-700">{blastMeta.query_len} bp</span></span>
                  <span>Hits: <span className="text-slate-700">{blastHits.length}</span></span>
                  <span>Time: <span className="text-slate-700">~{blastMeta.rtoe}s</span></span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setStep('input')}
                  className="px-3 py-1.5 text-xs font-medium rounded-md border border-slate-300 text-slate-600 hover:bg-slate-50 hover:text-slate-800 transition-colors"
                >
                  Edit Search
                </button>
                <button
                  onClick={handleReset}
                  className="px-3 py-1.5 text-xs font-medium rounded-md border border-red-200 text-red-600 hover:bg-red-50 transition-colors"
                >
                  Start Over
                </button>
              </div>
            </div>
          )}

          {/* BLAST Results Table */}
          {blastHits.length > 0 && <BlastResults hits={blastHits} />}

          {/* MSA Viewer */}
          {alignment && <MSAViewer alignment={alignment} />}
        </main>
      </div>
    </div>
  );
}

export default App;

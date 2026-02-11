import React from 'react';

interface BlastHit {
    accession: string;
    description: string;
    evalue: number;
    identity: number;
    query_cover: number;
}

interface BlastResultsProps {
    hits: BlastHit[];
}

const BlastResults: React.FC<BlastResultsProps> = ({ hits }) => {
    if (!hits || hits.length === 0) return null;

    return (
        <div className="mt-6 border border-slate-200 rounded-xl shadow-sm overflow-hidden bg-white">
            <div className="px-5 py-4 bg-gradient-to-r from-indigo-50 to-purple-50 border-b border-slate-200">
                <h2 className="text-lg font-semibold text-slate-800">
                    BLAST Results
                    <span className="ml-2 text-sm font-normal text-slate-500">
                        ({hits.length} hits)
                    </span>
                </h2>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="bg-slate-50 border-b border-slate-200">
                            <th className="px-4 py-3 text-left font-semibold text-slate-600">#</th>
                            <th className="px-4 py-3 text-left font-semibold text-slate-600">Accession</th>
                            <th className="px-4 py-3 text-left font-semibold text-slate-600">Description</th>
                            <th className="px-4 py-3 text-right font-semibold text-slate-600">E-value</th>
                            <th className="px-4 py-3 text-right font-semibold text-slate-600">Identity %</th>
                            <th className="px-4 py-3 text-right font-semibold text-slate-600">Query Cover %</th>
                        </tr>
                    </thead>
                    <tbody>
                        {hits.map((hit, idx) => (
                            <tr
                                key={idx}
                                className={`border-b border-slate-100 hover:bg-indigo-50/50 transition-colors ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'
                                    }`}
                            >
                                <td className="px-4 py-2.5 text-slate-400 font-mono text-xs">{idx + 1}</td>
                                <td className="px-4 py-2.5">
                                    <a
                                        href={`https://www.ncbi.nlm.nih.gov/nuccore/${hit.accession}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-indigo-600 hover:text-indigo-800 font-mono text-xs font-medium hover:underline"
                                    >
                                        {hit.accession}
                                    </a>
                                </td>
                                <td className="px-4 py-2.5 text-slate-700 max-w-md truncate">{hit.description}</td>
                                <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-600">
                                    {hit.evalue.toExponential(1)}
                                </td>
                                <td className="px-4 py-2.5 text-right">
                                    <span
                                        className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${hit.identity >= 95
                                            ? 'bg-green-100 text-green-700'
                                            : hit.identity >= 80
                                                ? 'bg-yellow-100 text-yellow-700'
                                                : 'bg-red-100 text-red-700'
                                            }`}
                                    >
                                        {hit.identity}%
                                    </span>
                                </td>
                                <td className="px-4 py-2.5 text-right font-mono text-xs text-slate-600">
                                    {hit.query_cover}%
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default BlastResults;

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
from .alignment import run_msa
from .blast import run_blast
import uvicorn

app = FastAPI()

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class SearchRequest(BaseModel):
    sequence: str
    max_hits: int = 50
    api_key: str = ""
    organism: Optional[str] = None
    e_value: Optional[float] = None
    perc_identity: Optional[float] = None


class BlastHit(BaseModel):
    accession: str
    description: str
    evalue: float
    identity: float
    query_cover: float


@app.post("/search")
async def search_and_align(request: SearchRequest):
    """
    Full pipeline: BLAST a query sequence, then run MSA on the top hits.
    """
    if not request.sequence.strip():
        raise HTTPException(status_code=400, detail="Sequence cannot be empty.")

    try:
        # Step 1: Run BLAST
        blast_hits, blast_meta = run_blast(
            request.sequence,
            max_hits=request.max_hits,
            api_key=request.api_key,
            organism=request.organism,
            e_value=request.e_value,
            perc_identity=request.perc_identity,
        )

        if not blast_hits:
            raise HTTPException(status_code=404, detail="No BLAST hits found.")

        # Step 2: Prepare sequences for MSA (query + hits)
        # Parse query: if it starts with '>', extract the header, otherwise use "Query"
        lines = request.sequence.strip().split("\n")
        if lines[0].startswith(">"):
            query_id = lines[0][1:].strip()
            query_seq = "".join(l.strip() for l in lines[1:] if not l.startswith(">"))
        else:
            query_id = "Query"
            query_seq = request.sequence.strip().replace(" ", "").replace("\n", "")

        msa_input = [{"id": query_id, "seq": query_seq}]
        for hit in blast_hits:
            msa_input.append({"id": hit["accession"], "seq": hit["sequence"]})

        # Step 3: Run MSA
        alignment = run_msa(msa_input)

        # Build hit summary for the frontend
        hit_summary = [
            {
                "accession": h["accession"],
                "description": h["description"],
                "evalue": h["evalue"],
                "identity": h["identity"],
                "query_cover": h["query_cover"],
            }
            for h in blast_hits
        ]

        return {
            "blast_hits": hit_summary,
            "blast_meta": blast_meta,
            "alignment": alignment,
            "num_hits": len(blast_hits),
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Keep the old /align endpoint for direct MSA usage
class Sequence(BaseModel):
    id: str
    seq: str


class AlignmentRequest(BaseModel):
    sequences: List[Sequence]


@app.post("/align")
async def align_sequences(request: AlignmentRequest):
    if len(request.sequences) < 2:
        raise HTTPException(
            status_code=400,
            detail="At least two sequences are required for alignment.",
        )
    try:
        data = [s.model_dump() for s in request.sequences]
        alignment = run_msa(data)
        return {"alignment": alignment}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))



class MoligizeRequest(BaseModel):
    sequence: str
    target_tm: float = 60.0
    tm_tolerance: float = 0.5
    # strict_tm removed, logic is now always strict based on tolerance
    min_len: int = 18
    max_len: int = 30  # Added max_len
    desired_len: Optional[int] = None
    p1_len: Optional[int] = None
    p2_len: Optional[int] = None
    split_idx: Optional[int] = None # 0-based index relative to sequence

@app.post("/moligize")
async def moligize_sequence(request: MoligizeRequest):
    try:
        import primer3
    except ImportError:
        raise HTTPException(status_code=500, detail="primer3-py is not installed on the server.")

    seq = request.sequence.upper().replace(" ", "").replace("\n", "").replace("-", "")
    if not seq:
        raise HTTPException(status_code=400, detail="Sequence is empty.")

    # Determine Split Index
    if request.split_idx is not None:
        split_idx = request.split_idx
    else:
        split_idx = len(seq) // 2
    
    # Boundary checks
    if split_idx < 1: split_idx = 1
    if split_idx >= len(seq): split_idx = len(seq) - 1

    # Determine Global Length Range
    if request.desired_len is not None:
        global_min = request.desired_len
        global_max = request.desired_len
    else:
        global_min = request.min_len
        global_max = min(split_idx, request.max_len) # Use user max_len

    # P1 (Forward/Left, ends at split_idx)
    p1_best = None
    p1_diff = float("inf")
    
    left_chunk = seq[:split_idx]
    
    # Specific P1 Length Override > Global Desired > Global Min/Max
    if request.p1_len is not None:
        p1_range_min = request.p1_len
        p1_range_max = request.p1_len
    else:
        p1_range_min = global_min
        p1_range_max = global_max
    
    # Clamp to available length
    p1_range_max = min(p1_range_max, len(left_chunk))
    p1_range_min = min(p1_range_min, len(left_chunk))

    # Iterate P1
    for l in range(p1_range_min, p1_range_max + 1):
        sub = left_chunk[-l:]
        from Bio.Seq import Seq
        rc_seq = str(Seq(sub).reverse_complement())
        
        tm = primer3.calc_tm(rc_seq)
        diff = abs(tm - request.target_tm)
        
        if diff > request.tm_tolerance:
            continue

        if diff < p1_diff:
            p1_diff = diff
            p1_best = {
                "seq": rc_seq,
                "tm": round(tm, 1),
                "len": l,
                "gc": round((rc_seq.count("G") + rc_seq.count("C")) / l * 100, 1),
                "start": split_idx - l,
                "end": split_idx
            }

    # P2 (Reverse/Right, starts at split_idx)
    p2_best = None
    p2_diff = float("inf")
    
    right_chunk = seq[split_idx:]
    
    # Specific P2 Length Override > Global Desired > Global Min/Max
    if request.p2_len is not None:
        p2_range_min = request.p2_len
        p2_range_max = request.p2_len
    else:
        p2_range_min = global_min
        p2_range_max = global_max

    p2_range_max = min(p2_range_max, len(right_chunk))
    p2_range_min = min(p2_range_min, len(right_chunk))

    for l in range(p2_range_min, p2_range_max + 1):
        sub = right_chunk[:l]
        tm = primer3.calc_tm(sub)
        diff = abs(tm - request.target_tm)
        
        if diff > request.tm_tolerance:
            continue
            
        if diff < p2_diff:
            p2_diff = diff
            p2_best = {
                "seq": sub,
                "tm": round(tm, 1),
                "len": l,
                "gc": round((sub.count("G") + sub.count("C")) / l * 100, 1),
                "start": split_idx,
                "end": split_idx + l
            }

    # If strict check fails, we might return None. Handle logic to inform user?
    # Using 400 to avoid confusion with 404 (Route Not Found)
    if not p1_best:
         raise HTTPException(status_code=400, detail="No Primer 1 found matching criteria. Try relaxing constraints.")
    if not p2_best:
         raise HTTPException(status_code=400, detail="No Primer 2 found matching criteria. Try relaxing constraints.")

    return {
        "p1": p1_best,
        "p2": p2_best,
        "split_idx": split_idx # Return actual used split idx
    }


if __name__ == "__main__":
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)

"""
BLAST search module using NCBI's BLAST REST API directly.
Uses requests for more control over the submission/polling process.
"""
import time
import requests
import xml.etree.ElementTree as ET
from typing import List, Dict, Tuple, Optional


BLAST_PUT_URL = "https://blast.ncbi.nlm.nih.gov/blast/Blast.cgi"


def run_blast(
    sequence: str,
    max_hits: int = 50,
    api_key: str = "",
    organism: Optional[str] = None,
    e_value: Optional[float] = None,
    perc_identity: Optional[float] = None,
) -> Tuple[List[Dict], Dict]:
    """
    Run NCBI BLAST search using the REST API and return top hits.
    Uses the aligned subject sequences directly from BLAST results.

    Args:
        sequence: The query nucleotide sequence (FASTA or raw).
        max_hits: Maximum number of hits to return.
        api_key: NCBI API key.
        organism: Organism name or taxid to filter by (e.g. "human", "txid9606").
        e_value: E-value threshold.
        perc_identity: Percent identity threshold (0-100).

    Returns:
        Tuple[List[Dict], Dict]:
            - List of hits (accession, description, evalue, identity, query_cover, sequence)
            - Metadata dict (rid, rtoe, query_len)
    """
    # Clean the sequence: handle FASTA format
    lines = sequence.strip().split("\n")
    if lines[0].startswith(">"):
        seq_lines = [l.strip() for l in lines[1:] if not l.startswith(">")]
    else:
        seq_lines = [l.strip() for l in lines]
    clean_seq = "".join(seq_lines).replace(" ", "").upper()

    if not clean_seq:
        raise RuntimeError("No sequence data found in input.")

    print(f"[BLAST] Submitting {len(clean_seq)} bp query to NCBI...")

    # Step 1: Submit the BLAST job
    params = {
        "CMD": "Put",
        "PROGRAM": "blastn",
        "DATABASE": "nt",
        "QUERY": clean_seq,
        "HITLIST_SIZE": str(max_hits),
        "FORMAT_TYPE": "XML",
    }
    if api_key:
        params["API_KEY"] = api_key
        print(f"[BLAST] Using NCBI API key")

    if organism:
        # Construct Entrez Query for organism
        # If it looks like a taxid (e.g. txid9606), use it directly, else assume name
        org_query = f"{organism}[ORGN]"
        params["ENTREZ_QUERY"] = org_query
        print(f"[BLAST] Filtering by organism: {org_query}")

    if e_value is not None:
        params["EXPECT"] = str(e_value)
        print(f"[BLAST] Filtering by E-value: {e_value}")

    response = requests.post(BLAST_PUT_URL, data=params)
    response.raise_for_status()

    # Parse RID from response
    rid = None
    rtoe = 10  # estimated time
    for line in response.text.split("\n"):
        if line.strip().startswith("RID ="):
            rid = line.split("=")[1].strip()
        if line.strip().startswith("RTOE ="):
            try:
                rtoe = int(line.split("=")[1].strip())
            except ValueError:
                rtoe = 10

    if not rid:
        raise RuntimeError("Failed to submit BLAST job: no RID returned")

    print(f"[BLAST] Job submitted. RID={rid}, estimated wait={rtoe}s")

    # Step 2: Poll for results
    # Wait the estimated time first
    wait_time = min(rtoe, 15)  # Don't wait more than 15s initially
    print(f"[BLAST] Waiting {wait_time}s before first poll...")
    time.sleep(wait_time)

    max_polls = 30  # Max ~5 minutes of polling
    for poll in range(max_polls):
        check_params = {
            "CMD": "Get",
            "FORMAT_OBJECT": "SearchInfo",
            "RID": rid,
        }
        check_resp = requests.get(BLAST_PUT_URL, params=check_params)
        check_resp.raise_for_status()

        if "Status=WAITING" in check_resp.text:
            print(f"[BLAST] Still waiting... (poll {poll + 1}/{max_polls})")
            time.sleep(3)
            continue
        elif "Status=FAILED" in check_resp.text:
            raise RuntimeError("BLAST search failed on NCBI servers.")
        elif "Status=READY" in check_resp.text:
            print("[BLAST] Results ready!")
            break
    else:
        raise RuntimeError("BLAST search timed out after 5 minutes.")

    # Step 3: Fetch results in XML format
    result_params = {
        "CMD": "Get",
        "FORMAT_TYPE": "XML",
        "RID": rid,
    }
    result_resp = requests.get(BLAST_PUT_URL, params=result_params)
    result_resp.raise_for_status()

    # Step 4: Parse the XML
    hits, query_len = _parse_blast_xml(result_resp.text)

    # Post-filter by % identity if requested
    if perc_identity is not None:
        print(f"[BLAST] Filtering by % identity >= {perc_identity}")
        hits = [h for h in hits if h["identity"] >= perc_identity]

    print(f"[BLAST] Returning {len(hits)} hits")
    metadata = {
        "rid": rid,
        "rtoe": rtoe,
        "query_len": query_len
    }
    return hits, metadata


def _parse_blast_xml(xml_text: str) -> Tuple[List[Dict], int]:
    """Parse BLAST XML output and extract hit information."""
    hits = []

    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        raise RuntimeError("Failed to parse BLAST XML response.")

    # Find query length
    query_len_el = root.find(".//BlastOutput_query-len")
    query_len = int(query_len_el.text) if query_len_el is not None and query_len_el.text else 0

    # Iterate through hits
    for hit in root.findall(".//Hit"):
        hit_accession = _get_text(hit, "Hit_accession")
        hit_def = _get_text(hit, "Hit_def")

        # Get best HSP
        hsp = hit.find(".//Hsp")
        if hsp is None:
            continue

        identity = int(_get_text(hsp, "Hsp_identity", "0"))
        align_len = int(_get_text(hsp, "Hsp_align-len", "1"))
        evalue = float(_get_text(hsp, "Hsp_evalue", "999"))
        hsp_sbjct = _get_text(hsp, "Hsp_hseq", "")

        identity_pct = round((identity / align_len) * 100, 1) if align_len > 0 else 0
        query_cover_pct = round((align_len / query_len) * 100, 1) if query_len > 0 else 0

        # Use the subject sequence from the HSP (remove gaps)
        subject_seq = hsp_sbjct.replace("-", "")

        if subject_seq:
            hits.append({
                "accession": hit_accession,
                "description": hit_def[:100] if hit_def else "",
                "evalue": evalue,
                "identity": identity_pct,
                "query_cover": query_cover_pct,
                "sequence": subject_seq,
            })

    return hits, query_len


def _get_text(element, tag: str, default: str = "") -> str:
    """Safely get text from an XML element."""
    child = element.find(tag)
    if child is not None and child.text:
        return child.text
    return default

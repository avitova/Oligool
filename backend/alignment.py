import tempfile
import subprocess
import os
from typing import List, Dict

def run_msa(sequences: List[Dict[str, str]]) -> str:
    """
    Run MAFFT alignment on a list of sequences.
    
    Args:
        sequences: List of dicts with 'id' and 'seq' keys.
        
    Returns:
        The aligned sequences in FASTA format.
    """
    if not sequences:
        return ""

    # Create temporary FASTA file
    with tempfile.NamedTemporaryFile(mode='w+', delete=False, suffix='.fasta') as temp_in:
        for seq in sequences:
            # Clean sequence
            clean_seq = seq['seq'].strip().replace(" ", "").upper()
            temp_in.write(f">{seq['id']}\n{clean_seq}\n")
        input_file = temp_in.name
    
    try:
        # Run MAFFT using subprocess
        # Assumes mafft is installed and in PATH
        cmd = ['mafft', '--auto', '--quiet', input_file]
        
        # Prepare environment with specific TMPDIR to avoid permission issues
        local_tmp_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tmp_mafft")
        os.makedirs(local_tmp_dir, exist_ok=True)
        env = os.environ.copy()
        env["TMPDIR"] = local_tmp_dir

        result = subprocess.run(cmd, capture_output=True, text=True, check=True, env=env)
        return result.stdout
        
    except subprocess.CalledProcessError as e:
        # If MAFFT fails, raise error with details
        raise RuntimeError(f"MAFFT alignment failed: {e.stderr}")
    except FileNotFoundError:
        # If MAFFT executable not found
        raise RuntimeError("MAFFT executable not found. Please ensure it is installed and in your PATH.")
    finally:
        # Clean up temp file
        if os.path.exists(input_file):
            os.remove(input_file)

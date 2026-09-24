"""
Builds and queries the RAG knowledge base (Section 8: KNOWLEDGE / DATA layer).

Loads the three knowledge base documents, splits them into paragraph-sized
chunks, embeds them with a local all-MiniLM-L6-v2 model, and stores them in
a persistent ChromaDB collection for retrieval.
"""

from pathlib import Path
import chromadb
from chromadb.utils import embedding_functions

PROJECT_ROOT = Path(__file__).parent
KB_FOLDER = PROJECT_ROOT / "data" / "knowledge_base"
CHROMA_DIR = PROJECT_ROOT / "chroma_db"

COLLECTION_NAME = "advising_knowledge_base"

# Local embedding model (no API key needed, runs on your machine).
# This is the all-MiniLM-L6-v2 model used across the course's earlier
# lessons, run through ONNX Runtime instead of PyTorch so the app fits in
# a small (512 MB) hosting instance.
embedding_fn = embedding_functions.ONNXMiniLM_L6_V2()


def source_title(source_name):
    """Human-readable title for a knowledge base file stem, for citations
    (e.g. "progression_rules" -> "Progression Rules")."""
    return source_name.replace("_", " ").title()


def chunk_document(text, source_name):
    """Split a knowledge base document into paragraph-level chunks.

    Each document is written with blank lines separating logical sections
    (see the .txt files in data/knowledge_base/), so splitting on blank
    lines gives us naturally coherent, self-contained chunks.
    """
    raw_chunks = [c.strip() for c in text.split("\n\n") if c.strip()]
    chunks = []
    for i, chunk in enumerate(raw_chunks):
        # Skip tiny fragments (e.g. a lone heading with nothing useful in it)
        if len(chunk) < 20:
            continue
        chunks.append({
            "id": f"{source_name}_{i}",
            "text": chunk,
            "source": source_name,
        })
    return chunks


def build_knowledge_base(reset=True):
    """Read all knowledge base .txt files, chunk them, and store in ChromaDB."""
    client = chromadb.PersistentClient(path=str(CHROMA_DIR))

    if reset:
        try:
            client.delete_collection(COLLECTION_NAME)
        except Exception:
            pass

    collection = client.get_or_create_collection(
        name=COLLECTION_NAME,
        embedding_function=embedding_fn,
    )

    all_chunks = []
    for txt_file in sorted(KB_FOLDER.glob("*.txt")):
        text = txt_file.read_text(encoding="utf-8")
        all_chunks.extend(chunk_document(text, txt_file.stem))

    if all_chunks:
        collection.add(
            ids=[c["id"] for c in all_chunks],
            documents=[c["text"] for c in all_chunks],
            metadatas=[{"source": c["source"]} for c in all_chunks],
        )

    print(f"Indexed {len(all_chunks)} chunks from {len(list(KB_FOLDER.glob('*.txt')))} documents.")
    return collection


def get_collection():
    """Get a handle to the existing knowledge base collection (build it if missing)."""
    client = chromadb.PersistentClient(path=str(CHROMA_DIR))
    try:
        return client.get_collection(name=COLLECTION_NAME, embedding_function=embedding_fn)
    except Exception:
        return build_knowledge_base()


def retrieve(query, n_results=3):
    """Retrieve the most relevant knowledge base chunks for a query.

    Returns a list of dicts: {"text": ..., "source": ..., "distance": ...}
    Lower distance = more relevant.
    """
    collection = get_collection()
    results = collection.query(query_texts=[query], n_results=n_results)

    hits = []
    for text, meta, dist in zip(
        results["documents"][0], results["metadatas"][0], results["distances"][0]
    ):
        hits.append({"text": text, "source": meta["source"], "distance": dist})
    return hits


if __name__ == "__main__":
    build_knowledge_base()
    print()
    test_query = "What are the prerequisites for OMIS 301?"
    print(f"Test query: {test_query}\n")
    for hit in retrieve(test_query):
        print(f"[{hit['source']}] (distance={hit['distance']:.3f})")
        print(hit["text"][:200])
        print()

from __future__ import annotations

import json
from urllib.error import HTTPError, URLError
from urllib.parse import quote, unquote, urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

from .core import AgentToolError, MAX_SKILL_FILE_BYTES


class _RejectRedirects(HTTPRedirectHandler):
    def redirect_request(self, request, file_pointer, code, message, headers, new_url):
        return None


class GitHubClient:
    """Read-only GitHub API client; it never clones or executes repository files."""

    def __init__(self):
        self._opener = build_opener(_RejectRedirects())

    def _get(self, url: str, accept: str) -> bytes:
        parsed = urlparse(url)
        if parsed.scheme != "https" or parsed.hostname not in {"api.github.com", "raw.githubusercontent.com"}:
            raise AgentToolError("GitHub response contained an unexpected URL host; download was refused.")
        request = Request(url, headers={"User-Agent": "lmstudio-local-agent/1.0", "Accept": accept})
        try:
            with self._opener.open(request, timeout=20) as response:
                if response.geturl() != url:
                    raise AgentToolError("Redirects are not followed for skill downloads.")
                body = response.read(MAX_SKILL_FILE_BYTES + 1)
                if len(body) > MAX_SKILL_FILE_BYTES:
                    raise AgentToolError("GitHub response exceeded the download size limit.")
                return body
        except AgentToolError:
            raise
        except HTTPError as error:
            raise AgentToolError(f"GitHub request failed with HTTP {error.code}; verify the URL and repository visibility.") from error
        except (URLError, TimeoutError, OSError) as error:
            raise AgentToolError("Could not reach GitHub. Check the network and try again.") from error

    def list_directory(self, owner: str, repo: str, ref: str, path: str) -> list[dict]:
        encoded_path = "/".join(quote(part, safe="") for part in path.split("/"))
        url = f"https://api.github.com/repos/{quote(owner)}/{quote(repo)}/contents/{encoded_path}?ref={quote(ref, safe='')}"
        try:
            result = json.loads(self._get(url, "application/vnd.github+json"))
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise AgentToolError("GitHub returned invalid JSON for the directory listing.") from error
        if not isinstance(result, list):
            raise AgentToolError("The GitHub URL must point to a directory, not a file.")
        return result

    def download(self, url: str, owner: str, repo: str, ref: str, expected_path: str) -> bytes:
        parsed = urlparse(url)
        actual_parts = [unquote(part) for part in parsed.path.strip("/").split("/")]
        expected_parts = [owner, repo, ref, *_safe_path_parts(expected_path)]
        if (
            parsed.scheme != "https"
            or parsed.hostname != "raw.githubusercontent.com"
            or parsed.port is not None
            or parsed.username is not None
            or parsed.password is not None
            or parsed.query
            or parsed.fragment
            or actual_parts != expected_parts
            or any(part in ("", ".", "..") or "\\" in part or "\x00" in part for part in actual_parts)
        ):
            raise AgentToolError("GitHub provided a download URL outside the requested repository and ref.")
        return self._get(url, "application/octet-stream")


def _safe_path_parts(path: str) -> list[str]:
    parts = path.split("/")
    if not parts or any(not part or part in (".", "..") or "\\" in part for part in parts):
        raise AgentToolError("The expected GitHub file path is unsafe.")
    return parts


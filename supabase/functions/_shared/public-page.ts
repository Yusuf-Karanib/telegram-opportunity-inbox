export interface FetchedPublicPage {
  url: string;
  text: string;
}

function publicUrl(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") ||
    !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname) ||
    /(?:^|\.)(?:localhost|local|internal|test|invalid)$/i.test(url.hostname)
  ) {
    throw new Error("Source is not a public HTTPS website");
  }
  return url;
}

export async function fetchPublicPage(
  value: string,
  fetcher: typeof fetch = fetch,
): Promise<FetchedPublicPage> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  const maximumBytes = 2_000_000;
  try {
    let url = publicUrl(value);
    for (let redirects = 0; redirects <= 4; redirects += 1) {
      const response = await fetcher(url.href, {
        signal: controller.signal,
        redirect: "manual",
        headers: { "user-agent": "Yusuf-Opportunity-Inbox/3.0" },
      });
      if (response.status >= 300 && response.status < 400 && response.headers.has("location")) {
        await response.body?.cancel();
        url = publicUrl(new URL(response.headers.get("location")!, url).href);
        continue;
      }
      if (!response.ok) throw new Error(`Source returned HTTP ${response.status}`);
      const type = response.headers.get("content-type") ?? "";
      if (type && !/html|json|text\/plain/i.test(type)) {
        await response.body?.cancel();
        throw new Error("Source did not return a readable page");
      }
      if (Number(response.headers.get("content-length") ?? 0) > maximumBytes) {
        await response.body?.cancel();
        throw new Error("Source page is too large");
      }
      const reader = response.body?.getReader();
      if (!reader) return { url: url.href, text: "" };
      const decoder = new TextDecoder();
      let text = "";
      let bytes = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > maximumBytes) {
          await reader.cancel();
          throw new Error("Source page is too large");
        }
        text += decoder.decode(chunk.value, { stream: true });
      }
      return { url: url.href, text: text + decoder.decode() };
    }
    throw new Error("Source redirected too many times");
  } finally {
    clearTimeout(timeout);
  }
}

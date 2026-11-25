/* FOUNDIT — Floating AI Assistant (Temporary Mock Responses Only — No AI Provider Connected) */

window.FOUNDIT = window.FOUNDIT || {};

window.FOUNDIT.aiAssistant = (() => {
  const { safe } = window.FOUNDIT.helpers;
  let isOpen = false;
  let isLoading = false;
  let lastFailedPrompt = "";

  const initialMessage = {
    role: "bot",
    text: "Hi! I'm the FOUNDIT Campus Assistant (Demo Mode with local mock responses). Ask me about reporting lost/found items, claim verification, or campus zones.",
    time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  };

  let messages = [{ ...initialMessage }];

  function toggle() {
    isOpen = !isOpen;
    const widget = document.getElementById("aiWidget");
    if (widget) widget.classList.toggle("open", isOpen);
    if (isOpen) {
      renderMessages();
      document.getElementById("aiInput")?.focus();
    }
  }

  function clearChat() {
    messages = [{
      role: "bot",
      text: "Chat cleared. How can I help you with FOUNDIT today? (Mock assistant)",
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    }];
    lastFailedPrompt = "";
    renderMessages();
  }

  function buildMockReply(promptText) {
    const q = promptText.toLowerCase();
    const state = window.FOUNDIT.store.getState();
    const openItems = state.items.filter((i) => i.status === "Open");

    if (q.includes("simulate error") || q.includes("test error")) {
      return { error: "Simulated assistant connection error (demo). Click Retry to test recovery." };
    }

    // Dynamic zone lookup from local state
    const matchedZone = window.FOUNDIT.MOCK_DATA.CAMPUS_ZONES.find((z) =>
      q.includes(z.toLowerCase())
    );
    if (matchedZone) {
      const zoneItems = openItems.filter((i) => i.location === matchedZone);
      if (zoneItems.length === 0) {
        return { text: `There are currently 0 open items reported in ${matchedZone}. You can submit a new report under "Report Item" or click ${matchedZone} on the campus map.` };
      }
      const list = zoneItems.slice(0, 3).map((i) => `• ${i.name} (${i.type})`).join("\n");
      return { text: `Found ${zoneItems.length} open report(s) in ${matchedZone}:\n${list}\nOpen the Browse page and filter by "${matchedZone}" to view details.` };
    }

    if (q.includes("report") || q.includes("lost") || q.includes("found")) {
      return {
        text: "To report an item: open 'Report Item' in the top bar, choose 'I LOST' or 'I FOUND', select the category and JCET campus zone, optionally upload a photo (< 700 KB), and submit. Avoid sharing private ID numbers publicly."
      };
    }

    if (q.includes("claim") || q.includes("verify") || q.includes("ownership")) {
      return {
        text: "To claim a Found item: click 'View details' -> 'This is mine — submit claim', and write a brief ownership explanation (like a sticker, dent, or note inside). Demo Admin reviews pending claims before handover."
      };
    }

    if (q.includes("handover") || q.includes("two-party") || q.includes("return")) {
      return {
        text: "Two-party handover ensures safe returns: once a claim is Approved, the Finder clicks 'I handed over the item' and the Claimant clicks 'I received the item' in My Dashboard. Once both confirm, the item becomes 'Returned'."
      };
    }

    if (q.includes("zone") || q.includes("map") || q.includes("campus")) {
      return {
        text: "Supported JCET campus zones: Academic Block, Library, Computer Labs, Canteen, Auditorium, Playground, and Parking Area. You can click any building on the Home page map to filter reports."
      };
    }

    if (q.includes("stat") || q.includes("how many") || q.includes("open")) {
      const lost = state.items.filter((i) => i.type === "lost").length;
      const found = state.items.filter((i) => i.type === "found").length;
      const returned = state.items.filter((i) => i.status === "Returned").length;
      return {
        text: `Current demo campus totals: ${state.items.length} reports (${lost} lost, ${found} found, ${returned} returned). Visit Browse to search all listings.`
      };
    }

    return {
      text: "Mock AI Reply: I can help you report lost/found items, check open reports by JCET zone (e.g. 'open items in Library'), or explain claim verification and two-party handover."
    };
  }

  function sendPrompt(rawText) {
    const input = document.getElementById("aiInput");
    const text = (rawText ?? input?.value ?? "").trim();
    if (!text || isLoading) return;
    if (input && rawText === undefined) input.value = "";

    const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    messages.push({ role: "user", text, time: now });
    isLoading = true;
    renderMessages();

    setTimeout(() => {
      isLoading = false;
      const reply = buildMockReply(text);
      const replyTime = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      if (reply.error) {
        lastFailedPrompt = text;
        messages.push({ role: "error", text: reply.error, time: replyTime });
      } else {
        lastFailedPrompt = "";
        messages.push({ role: "bot", text: reply.text, time: replyTime });
      }
      renderMessages();
    }, 550);
  }

  function retryLast() {
    if (!lastFailedPrompt || isLoading) return;
    const retryText = lastFailedPrompt;
    lastFailedPrompt = "";
    sendPrompt(retryText === "simulate error" ? "How do I report a lost item?" : retryText);
  }

  function renderSuggestions() {
    const container = document.getElementById("aiSuggestions");
    if (!container) return;
    container.innerHTML = window.FOUNDIT.MOCK_DATA.AI_SUGGESTED_QUESTIONS.map(
      (q) => `<button type="button" onclick="window.FOUNDIT.aiAssistant.sendPrompt('${safe(q).replace(/'/g, "\\'")}')">${safe(q)}</button>`
    ).join("");
  }

  function renderMessages() {
    const list = document.getElementById("aiMessages");
    if (!list) return;

    list.innerHTML = messages.map((m) => {
      const formatted = safe(m.text).replace(/\n/g, "<br>");
      const retryBtn = m.role === "error"
        ? `<div style="margin-top:8px"><button class="btn btn-small btn-outline" onclick="window.FOUNDIT.aiAssistant.retryLast()">Retry</button></div>`
        : "";
      return `
        <div class="ai-msg ${m.role}">
          <div>${formatted}</div>
          ${retryBtn}
          <time>${safe(m.time)}</time>
        </div>
      `;
    }).join("");

    if (isLoading) {
      list.innerHTML += `
        <div class="ai-msg bot">
          <div class="typing-dots"><span></span><span></span><span></span></div>
        </div>
      `;
    }
    list.scrollTop = list.scrollHeight;
  }

  function init() {
    renderSuggestions();
    renderMessages();
    const form = document.getElementById("aiForm");
    if (form) {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        sendPrompt();
      });
    }
  }

  return {
    init,
    toggle,
    clearChat,
    sendPrompt,
    retryLast
  };
})();

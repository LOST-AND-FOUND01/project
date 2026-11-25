/* FOUNDIT — Floating Campus FAQ Chatbot (Lightweight Predefined & Live-State Assistant) */

window.FOUNDIT = window.FOUNDIT || {};

window.FOUNDIT.aiAssistant = (() => {
  const { safe } = window.FOUNDIT.helpers;
  let isOpen = false;
  let isLoading = false;
  let lastFailedPrompt = "";

  const initialMessage = {
    role: "bot",
    text: "Hi! I'm the FOUNDIT Campus Assistant. Ask me how to report lost/found items, submit a claim, contact a finder/owner via private chat, or where to collect found items.",
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
      text: "Chat cleared. How can I help you use FOUNDIT today?",
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    }];
    lastFailedPrompt = "";
    renderMessages();
  }

  function buildFaqReply(promptText) {
    const q = promptText.toLowerCase();
    const state = window.FOUNDIT.store.getState();
    const availableItems = state.items.filter((i) => ["Available", "Claim Requested"].includes(i.status));

    if (q.includes("simulate error") || q.includes("test error")) {
      return { error: "Simulated assistant connection error. Click Retry to test recovery." };
    }

    // Dynamic zone lookup from live database state
    const matchedZone = window.FOUNDIT.MOCK_DATA.CAMPUS_ZONES.find((z) =>
      q.includes(z.toLowerCase())
    );
    if (matchedZone) {
      const zoneItems = availableItems.filter((i) => i.location === matchedZone);
      if (zoneItems.length === 0) {
        return { text: `There are currently 0 active items reported in ${matchedZone}. You can post a report under "Report Item" or click ${matchedZone} on the campus map.` };
      }
      const list = zoneItems.slice(0, 3).map((i) => `• ${i.name} (${i.type} · ${i.status})`).join("\n");
      return { text: `Active report(s) in ${matchedZone} (${zoneItems.length}):\n${list}\nOpen Browse and filter by "${matchedZone}" to view details.` };
    }

    if (q.includes("contact") || q.includes("chat") || q.includes("message") || q.includes("phone") || q.includes("email")) {
      return {
        text: "For privacy, finder/owner phone numbers and emails are hidden publicly. To contact the finder: open a Found item, click 'Claim', and once the finder approves your claim, the Private Finder–Owner Chat unlocks inside My Dashboard -> Private Chat!"
      };
    }

    if (q.includes("collect") || q.includes("where") || q.includes("pickup") || q.includes("desk")) {
      return {
        text: "Each Found item's details page displays the campus building/block and optional specific spot where it was found. Once your claim is approved by the finder, use Private Chat in My Dashboard to agree on the exact pickup spot and time (or meet at the Student Welfare Desk in Academic Block)."
      };
    }

    if (q.includes("lost")) {
      return {
        text: "To report a lost item: sign in via Account, open 'Report Item', choose 'I LOST this item', select the category and campus zone, add optional specific location details or a photo, and submit. Other students can then post sighting updates with locations on your item."
      };
    }

    if (q.includes("found")) {
      return {
        text: "To report a found item: sign in, open 'Report Item', select 'I FOUND this item', enter the campus zone and specific spot where you found it, optionally attach a photo, and submit. You are saved as the finder and can approve or reject incoming claims in My Dashboard."
      };
    }

    if (q.includes("claim")) {
      return {
        text: "To claim a Found item: sign in (as a user other than the finder), open the item in Browse, click 'Claim' (or 'This is mine — submit claim'), and describe unique identifying marks/proof. The finder reviews your request in My Dashboard."
      };
    }

    if (q.includes("return") || q.includes("handover") || q.includes("status")) {
      return {
        text: "Item statuses progress from Available -> Claim Requested -> Claim Approved -> Returned (or Closed). Approving a claim does NOT auto-mark it Returned; after physical handover, the finder clicks 'Confirm Item Handed Over' in My Dashboard."
      };
    }

    if (q.includes("use") || q.includes("how") || q.includes("faq") || q.includes("help")) {
      return {
        text: "Quick Guide:\n1) Sign up or log in under Account.\n2) Use Browse or the Campus Map to search items.\n3) Report lost/found items under Report Item.\n4) Submit claims on Found items or post sightings on Lost items.\n5) Coordinate handover in Private Chat once approved, then confirm return!"
      };
    }

    return {
      text: "I can help with: reporting a lost or found item, claiming an item, contacting a finder/owner via private chat, finding collection locations, or checking active items in a JCET zone (e.g. 'items in Library')."
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
      const reply = buildFaqReply(text);
      const replyTime = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      if (reply.error) {
        lastFailedPrompt = text;
        messages.push({ role: "error", text: reply.error, time: replyTime });
      } else {
        lastFailedPrompt = "";
        messages.push({ role: "bot", text: reply.text, time: replyTime });
      }
      renderMessages();
    }, 350);
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
        ? `<div style="margin-top:8px"><button type="button" class="btn btn-small btn-outline" onclick="window.FOUNDIT.aiAssistant.retryLast()">Retry</button></div>`
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

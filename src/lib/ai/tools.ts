// Tool (function) definitions given to the LLM. They are plain JSON Schema,
// so the same definitions work for Claude, OpenAI and Gemini with small
// wrapper changes.
const lineItems = {
  type: "array",
  items: {
    type: "object",
    properties: { name: { type: "string" }, qty: { type: "number" }, price: { type: "number" } },
    required: ["name"],
  },
} as const;

const rrule = {
  type: ["string", "null"],
  description:
    "Repeat rule for recurring tasks/bills, RFC 5545 subset: 'FREQ=DAILY|WEEKLY|MONTHLY|YEARLY;INTERVAL=n'. e.g. monthly rent -> 'FREQ=MONTHLY;INTERVAL=1'. null if not recurring.",
} as const;

export const ACTION_TOOLS = [
  {
    name: "create_note",
    description: "Save a note in the Notes tab. Use for ideas, meeting notes, summaries, anything to remember.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short title (max 8 words)" },
        content: { type: "string", description: "Note body. Light markdown allowed (bullets with •, or -)." },
        tags: { type: "array", items: { type: "string" } },
        ref: { type: "string", description: "Optional id like 'n1' so tasks/spending in the same reply can link to this note" },
      },
      required: ["title", "content"],
    },
  },
  {
    name: "create_todo",
    description:
      "Add a task to the To-Do tab. Resolve relative dates ('tomorrow 9am', 'next Friday') into absolute ISO 8601 timestamps WITH the user's UTC offset. If the user asks to be reminded, set remindAt. For repeating tasks or bills (rent, internet, subscriptions) set rrule; if it costs money set bill so paying it logs spending.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        notes: { type: "string" },
        dueAt: { type: ["string", "null"], description: "ISO 8601 datetime with offset, or null" },
        remindAt: { type: ["string", "null"], description: "ISO 8601 datetime with offset, or null" },
        priority: { type: "string", enum: ["low", "medium", "high"] },
        rrule,
        bill: {
          type: ["object", "null"],
          description: "For bills: the amount logged to Finance when the task is completed",
          properties: {
            amount: { type: "number" },
            currency: { type: "string" },
            category: { type: "string", description: "One of the user's categories, except Income." },
          },
          required: ["amount", "category"],
        },
        noteRef: { type: "string", description: "ref of a note created in this same reply, to link the task to it" },
      },
      required: ["title"],
    },
  },
  {
    name: "complete_todo",
    description: "Mark an existing open task as done. Match by a distinctive part of its title.",
    input_schema: {
      type: "object",
      properties: { titleContains: { type: "string" } },
      required: ["titleContains"],
    },
  },
  {
    name: "add_transaction",
    description:
      "Record money spent (positive amount) or received (negative amount, category Income) in the Finance tab. Also use for pasted e-wallet or bank notifications (GoPay, OVO, DANA, ShopeePay, QRIS, BCA, Mandiri…).",
    input_schema: {
      type: "object",
      properties: {
        merchant: { type: "string" },
        amount: { type: "number", description: "Number only, no thousand separators. Positive = spending." },
        currency: { type: "string", description: "ISO 4217 code, default to the user's currency" },
        category: { type: "string", description: "One of the user's categories (listed in <user_data> as categories). Use 'Other' when none fit." },
        date: { type: "string", description: "YYYY-MM-DD" },
        items: lineItems,
        splitWith: { type: "array", items: { type: "string" }, description: "Names of people splitting this bill equally with the user" },
        noteRef: { type: "string" },
      },
      required: ["merchant", "amount", "category", "date"],
    },
  },
  {
    name: "split_transaction",
    description: "Split an existing expense equally with other people, e.g. 'split the Warteg bill with Andi and Budi'.",
    input_schema: {
      type: "object",
      properties: {
        merchantContains: { type: "string" },
        people: { type: "array", items: { type: "string" } },
        includeMe: { type: "boolean", description: "Whether the user also pays a share (default true)" },
      },
      required: ["merchantContains", "people"],
    },
  },
  {
    name: "set_budget",
    description: "Set a monthly budget for a spending category, in the user's base currency.",
    input_schema: {
      type: "object",
      properties: {
        category: { type: "string", description: "One of the user's categories, except Income." },
        amount: { type: "number" },
      },
      required: ["category", "amount"],
    },
  },
  {
    name: "create_sticky",
    description: "Pin a very short reminder (max ~15 words) to the sticky-notes bar at the top.",
    input_schema: {
      type: "object",
      properties: {
        text: { type: "string" },
        color: { type: "string", enum: ["yellow", "pink", "blue", "green"] },
      },
      required: ["text"],
    },
  },
] as const;

// One forced tool for images and recordings: the model classifies AND extracts
// in a single call, which is cheaper and faster than two calls.
export const FILE_CAPTURE_TOOL = {
  name: "file_capture",
  description: "Classify the captured content and extract structured data so the app can file it in the right tab.",
  input_schema: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        enum: ["receipt", "handwritten_note", "todo_list", "other"],
        description:
          "receipt = store receipt / invoice / payment proof / e-wallet or bank app screenshot (GoPay, OVO, DANA, QRIS, m-banking). handwritten_note = handwriting or typed notes. todo_list = a checklist of tasks. other = anything else.",
      },
      reply: { type: "string", description: "One friendly sentence telling the user where it was filed." },
      note: {
        type: "object",
        description: "For handwritten_note, other, or recordings: transcribed/summarized note.",
        properties: {
          title: { type: "string" },
          content: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
        },
        required: ["title", "content"],
      },
      receipt: {
        type: "object",
        description: "For receipts only.",
        properties: {
          merchant: { type: "string" },
          total: { type: "number", description: "Grand total actually paid, number only. Negative if money was received." },
          currency: { type: "string" },
          date: { type: "string", description: "YYYY-MM-DD; use today if not visible" },
          category: { type: "string", description: "One of the user's categories (listed in <user_data> as categories). Use 'Other' when none fit." },
          items: lineItems,
        },
        required: ["merchant", "total", "date", "category"],
      },
      todos: {
        type: "array",
        description: "Tasks / action items found (checklists, or action items in a recording).",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            dueAt: { type: ["string", "null"] },
            priority: { type: "string", enum: ["low", "medium", "high"] },
            rrule,
          },
          required: ["title"],
        },
      },
    },
    required: ["kind", "reply"],
  },
} as const;

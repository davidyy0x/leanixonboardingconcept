// ==UserScript==
// @name         LeanIX AI-Native Onboarding Guide
// @namespace    http://tampermonkey.net/
// @version      3.0
// @description  AI-native onboarding guide panel for SAP LeanIX
// @author       David Halb
// @match        https://eu-18.leanix.net/DavidHalbBTMDemo/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';
  if (document.getElementById('lx-guide-root')) return;

  // ── DOM helpers ───────────────────────────────────────────────────────
  // Never use innerHTML — LeanIX has trusted-types CSP that blocks it.
  // Build everything with createElement + textContent + setAttribute.

  function el(tag, attrs) {
    const e = document.createElement(tag);
    if (attrs) {
      Object.entries(attrs).forEach(([k, v]) => {
        if (k === 'cls') e.className = v;
        else if (k === 'text') e.textContent = v;
        else if (k === 'style') e.style.cssText = v;
        else e.setAttribute(k, v);
      });
    }
    return e;
  }

  function append(parent, ...children) {
    children.forEach(c => {
      if (typeof c === 'string') parent.appendChild(document.createTextNode(c));
      else if (c) parent.appendChild(c);
    });
    return parent;
  }

  function div(cls, ...children)  { return append(el('div', {cls}), ...children); }
  function span(cls, text)        { return el('span', {cls, text}); }
  function btn(cls, text, fn)     { const b = el('button', {cls, text}); b.addEventListener('click', fn, true); return b; }
  function a(href, text)          { const e = el('a', {href, target:'_blank', text}); return e; }
  function txt(t)                 { return document.createTextNode(t); }

  // Render a block of structured content into a container using DOM nodes
  // htmlStr is ONLY used for the guide panel body where we need complex HTML.
  // We use DOMParser which is not subject to trusted-types.
  function setContent(container, htmlStr) {
    const doc = new DOMParser().parseFromString('<body>' + htmlStr + '</body>', 'text/html');
    const nodes = Array.from(doc.body.childNodes).map(n => document.importNode(n, true));
    while (container.firstChild) container.removeChild(container.firstChild);
    nodes.forEach(n => container.appendChild(n));
    wireBodyClicks(container);
  }

  // ── State ─────────────────────────────────────────────────────────────
  let panelOpen = true;
  let selectedIntent = null;
  let activeTab = 'journey';
  let activeFsGuide = 'application';
  let ws = {
    appCount:0, bcCount:0, relCount:0, itcCount:0,
    ifaceCount:0, userCount:1, functFitPct:0,
    ownersPct:0, timePct:0, daysSinceStart:1,
    licenseLimit:500
  };

  // ── Data ──────────────────────────────────────────────────────────────
  const INTENTS = {
    rationalization: {
      id:'rationalization', icon:'🗂️',
      title:'Show which apps to cut or consolidate',
      jobStatement:'Get a defensible portfolio view for your steering committee — showing which applications are redundant, underperforming, or ready to retire.',
      audience:'CTO, CFO, IT Steering Committee',
      timeToResult:'2–4 hours of data entry',
      targetReport:'Portfolio Matrix',
      targetReportDesc:'Applications mapped to business capabilities, colored by lifecycle and functional fit.',
      targetReportUrl:'https://eu-18.leanix.net/DavidHalbBTMDemo/reporting/matrix',
    },
    aigovernance: {
      id:'aigovernance', icon:'🔐',
      title:'Map AI tool usage and tech risk across the org',
      jobStatement:'Know which AI tools and technology are in use, who owns them, and which are approaching end of life.',
      audience:'CISO, CTO, Compliance / Audit',
      timeToResult:'3–5 hours of data entry',
      targetReport:'Technology Landscape',
      targetReportDesc:'IT components (including AI tools) mapped by business unit with lifecycle status.',
      targetReportUrl:'https://eu-18.leanix.net/DavidHalbBTMDemo/reporting/landscape',
    },
    erptransformation: {
      id:'erptransformation', icon:'🚀',
      title:'Define transformation scope and sequence',
      jobStatement:'Show the CFO and programme sponsor what is in scope for the transformation and what a realistic migration sequence looks like.',
      audience:'CFO, Programme Sponsor, SAP Partner',
      timeToResult:'4–8 hours of data entry',
      targetReport:'Transformation Roadmap',
      targetReportDesc:'Applications classified by TIME model, grouped into migration waves.',
      targetReportUrl:'https://eu-18.leanix.net/DavidHalbBTMDemo/reporting/timeline',
    },
    aiagents: {
      id:'aiagents', icon:'🤖',
      title:'Build your AI agent inventory',
      jobStatement:'Know which AI agents are running in your organization — who built them, which business functions they serve, and whether they are governed.',
      audience:'CTO, CISO, AI/ML Platform Team',
      timeToResult:'2–3 hours of data entry',
      targetReport:'AI Agent Landscape',
      targetReportDesc:'All AI agent fact sheets mapped to business capabilities and owning teams — your governance baseline.',
      targetReportUrl:'https://eu-18.leanix.net/DavidHalbBTMDemo/reporting/landscape',
      aiUpsell:'Once your agent inventory is complete, the EA Assistant can answer: "Which AI agents operate without a defined owner?" or "Which BCs have no AI agent support yet?"',
    },
    obsolescence: {
      id:'obsolescence', icon:'⚠️',
      title:'Identify technology before it becomes a risk',
      jobStatement:'Surface every IT component approaching end-of-life before it causes a security incident, compliance failure, or unplanned downtime.',
      audience:'CISO, IT Operations, Audit & Compliance',
      timeToResult:'3–5 hours of data entry',
      targetReport:'Obsolescence Risk Dashboard',
      targetReportDesc:'IT components color-coded by risk status — end-of-life, end-of-maintenance, and approaching — mapped to business criticality.',
      targetReportUrl:'https://eu-18.leanix.net/DavidHalbBTMDemo/reporting/landscape',
      aiUpsell:'With the EA Assistant: ask "Which IT components reach end of life in the next 90 days and support mission-critical applications?" — instant risk prioritization list.',
    },
    costtransparency: {
      id:'costtransparency', icon:'💰',
      title:'Map IT costs to business units and capabilities',
      jobStatement:'Show the CFO which business units are driving IT spend, where costs are duplicated, and which applications cost more than their business value justifies.',
      audience:'CFO, IT Finance, CIO',
      timeToResult:'4–6 hours of data entry',
      targetReport:'Cost by Business Unit',
      targetReportDesc:'Application costs allocated to organizations and business capabilities — your IT spend transparency view.',
      targetReportUrl:'https://eu-18.leanix.net/DavidHalbBTMDemo/reporting/matrix',
      aiUpsell:'With the EA Assistant: ask "Which business capabilities have the highest cost-per-application ratio?" to surface consolidation opportunities instantly.',
    },
  };

  const RULES = {
    rationalization: [
      { id:'r1', active:w=>w.appCount===0, done:w=>w.appCount>0,
        title:'Import your applications',
        why:'Without this, your Portfolio Matrix has nothing to show.',
        time:'30–60 min for a first list of 20–50 apps',
        context:'Even a rough list of 20–30 applications is enough to get started.',
        actionLabel:'Go to Inventory → Import',
        actionUrl:'https://eu-18.leanix.net/DavidHalbBTMDemo/inventory',
        docTitle:'Importing applications via Excel',
        docWhy:'The fastest way to bring in a bulk list — no manual entry needed.',
        docSteps:['Go to Inventory → Inventory Tools → Import','Download the Application import template','Fill in: Name, Lifecycle status, Owner','Upload and review the preview','Confirm — applications appear immediately'],
        docLink:'https://help.sap.com/docs/leanix/ea/importing-fact-sheet-data-through-excel-file',
        docLinkLabel:'Full import guide →',
      },
      { id:'r2', active:w=>w.appCount>0&&w.bcCount===0, done:w=>w.bcCount>0,
        title:'Set up business capabilities',
        why:'BCs are the axes of the Portfolio Matrix — without them the report is a flat list.',
        time:'20–30 min using the SAP reference catalog',
        context:'Business capabilities let you see which apps support which business functions.',
        actionLabel:'Go to Inventory → Business Capability',
        actionUrl:'https://eu-18.leanix.net/DavidHalbBTMDemo/inventory?type=BusinessCapability',
        docTitle:'3 ways to build your BC model',
        docWhy:'Most customers start with the SAP Reference Catalog — a pre-built L1/L2 model.',
        docSteps:['Option 1 (recommended): Open Reference Catalog and import the SAP BC model','Option 2: Import your own BC hierarchy via Excel','Option 3: Create BCs manually in Inventory','Aim for 7–20 Level 1 capabilities to start','Add descriptions so others understand each capability'],
        docLink:'https://help.sap.com/docs/leanix/ea/business-capabilities-in-reference-catalog',
        docLinkLabel:'BC Reference Catalog guide →',
        docLink2:'https://help.sap.com/docs/leanix/ea/business-capability-modeling-guidelines',
        docLink2Label:'BC Modeling Guidelines →',
      },
      { id:'r3', active:w=>w.appCount>0&&w.bcCount>0&&w.relCount===0, done:w=>w.relCount>0,
        title:'Link applications to capabilities',
        why:'The Matrix is empty until apps are connected to BCs.',
        time:'1–2 hours (faster with bulk import)',
        countFn:w=>w.appCount>0?w.appCount+' apps unlinked':null,
        context:'Linking apps to BCs is what populates the Matrix.',
        actionLabel:'Open an Application fact sheet',
        actionUrl:'https://eu-18.leanix.net/DavidHalbBTMDemo/inventory?type=Application',
        docTitle:'Linking applications to business capabilities',
        docWhy:'For 10+ apps, use the bulk import — far faster than editing each fact sheet manually.',
        docSteps:['Open any Application fact sheet','Go to the Relations tab','Click + Add → select the matching Business Capability','For bulk linking: use Excel import with sourceId/targetId column','Matrix updates in real time as you add relations'],
        docLink:'https://help.sap.com/docs/leanix/ea/bulk-updating-data-in-inventory-table-view',
        docLinkLabel:'Bulk update guide →',
      },
      { id:'r4', active:w=>w.appCount>0&&w.bcCount>0&&w.relCount>0&&w.functFitPct<50, done:w=>w.functFitPct>=50,
        title:'Add functional fit & criticality',
        why:'This is the color-coding — without it the Matrix shows structure but not the rationalization signal.',
        time:'1–3 days via survey (owners fill it, not you)',
        countFn:w=>w.appCount>0?Math.round(w.appCount*(100-w.functFitPct)/100)+' apps missing':null,
        context:'Functional fit and business criticality let you color the Matrix by performance.',
        actionLabel:'Go to More → Surveys',
        actionUrl:'https://eu-18.leanix.net/DavidHalbBTMDemo/surveys',
        docTitle:'Collecting functional fit via survey',
        docWhy:'Send a survey to app owners — they fill it without accessing the workspace.',
        docSteps:['Go to More → Surveys → Create Survey','Select Functional Fit and Business Criticality as fields','Choose recipients by subscription role','Send — owners receive an email link','Responses update fact sheets automatically'],
        docLink:'https://help.sap.com/docs/leanix/ea/creating-survey',
        docLinkLabel:'Survey setup guide →',
      },
      { id:'r5', active:w=>w.appCount>0&&w.bcCount>0&&w.relCount>0&&w.functFitPct>=50, done:()=>false,
        isFinish:true, title:'Open your Portfolio Matrix',
        context:'You are ready. Your rationalization candidates are now visible.',
        actionLabel:'Open Portfolio Matrix',
        actionUrl:'https://eu-18.leanix.net/DavidHalbBTMDemo/reporting/matrix',
      },
    ],
    aigovernance: [
      { id:'a1', active:w=>w.appCount===0, done:w=>w.appCount>0,
        title:'Import your applications',
        why:'Start with apps that use AI tools or SaaS — highest-risk first.',
        context:'Focus on applications that use AI tools, cloud platforms, or SaaS vendors.',
        actionLabel:'Go to Inventory → Import',
        actionUrl:'https://eu-18.leanix.net/DavidHalbBTMDemo/inventory',
        docTitle:'Importing applications via Excel',
        docWhy:'A 20-entry list is enough to start your AI governance map.',
        docSteps:['Go to Inventory → Inventory Tools → Import','Download the Application import template','Fill in: Name, Lifecycle status, Owner','Upload and confirm','Focus on apps that use AI tools or cloud platforms'],
        docLink:'https://help.sap.com/docs/leanix/ea/importing-fact-sheet-data-through-excel-file',
        docLinkLabel:'Full import guide →',
      },
      { id:'a2', active:w=>w.appCount>0&&w.itcCount===0, done:w=>w.itcCount>0,
        title:'Add IT components & AI tools',
        why:'IT components — especially AI tools and SaaS — are what the governance map is about.',
        time:'1–2 hours for a first inventory of key tools',
        context:'IT Components are the technology behind your apps: databases, AI models, cloud services.',
        actionLabel:'New Fact Sheet → IT Component',
        actionUrl:'https://eu-18.leanix.net/DavidHalbBTMDemo/inventory?type=ITComponent',
        docTitle:'Application vs IT Component',
        docWhy:'An Application is what users interact with. An IT Component is the tech it runs on.',
        docSteps:['Go to Inventory → New Fact Sheet → IT Component','Set Tech Category: AI, Cloud Native, SaaS, or On-Premise','Set vendor and product name (e.g. OpenAI GPT-4)','Set End of Life date — this drives the risk report','Link to the application via the Relations tab'],
        docLink:'https://help.sap.com/docs/leanix/ea/getting-started-building-your-it-component-inventory',
        docLinkLabel:'IT Component guide →',
      },
      { id:'a3', active:w=>w.appCount>0&&w.itcCount>0&&w.relCount===0, done:w=>w.relCount>0,
        title:'Link apps to their technology',
        why:'Without this link you cannot answer which team uses which AI tool.',
        countFn:w=>w.appCount>0?w.appCount+' apps unlinked':null,
        context:'Connecting apps to IT components lets you trace AI tool usage to the owning team.',
        actionLabel:'Open Application → Relations',
        actionUrl:'https://eu-18.leanix.net/DavidHalbBTMDemo/inventory?type=Application',
        docTitle:'Linking applications to IT components',
        docWhy:'The uses relation maps an application to its technology stack.',
        docSteps:['Open an Application fact sheet','Go to Relations → Technical Stack','Click + Add → select the IT Component','Repeat for each AI tool or cloud service','For bulk: use Excel import with sourceId/targetId'],
        docLink:'https://help.sap.com/docs/leanix/ea/bulk-updating-data-in-inventory-table-view',
        docLinkLabel:'Bulk relation import →',
      },
      { id:'a4', active:w=>w.appCount>0&&w.itcCount>0&&w.relCount>0, done:()=>false,
        isFinish:true, title:'Open Technology Landscape',
        context:'Your AI governance view is ready. See which tools are in use and which are nearing end of life.',
        actionLabel:'Open Technology Landscape',
        actionUrl:'https://eu-18.leanix.net/DavidHalbBTMDemo/reporting/landscape',
      },
    ],
    erptransformation: [
      { id:'e1', active:w=>w.appCount===0, done:w=>w.appCount>0,
        title:'Import your application landscape',
        context:'Focus first on applications connected to your ERP — finance, HR, supply chain.',
        actionLabel:'Go to Inventory → Import',
        actionUrl:'https://eu-18.leanix.net/DavidHalbBTMDemo/inventory',
        docTitle:'Importing the ERP landscape',
        docWhy:'A scoped import of 30–50 ERP-adjacent applications is enough to start.',
        docSteps:['Go to Inventory → Inventory Tools → Import','Download the Application import template','Fill in: Name, Lifecycle, Owner','Tag ERP-connected apps clearly','Include your current ERP system itself'],
        docLink:'https://help.sap.com/docs/leanix/ea/importing-fact-sheet-data-through-excel-file',
        docLinkLabel:'Full import guide →',
      },
      { id:'e2', active:w=>w.appCount>0&&w.timePct<30, done:w=>w.timePct>=30,
        title:'Apply the TIME model',
        why:'TIME classification turns your app list into a transformation scope the CFO can approve.',
        time:'2–4 hours for first 30% of the portfolio',
        countFn:w=>w.appCount>0?Math.round(w.appCount*(100-w.timePct)/100)+' apps unclassified':null,
        context:'Classify at least your most critical 30% to see the shape of the migration.',
        actionLabel:'Inventory → Bulk Edit → TIME field',
        actionUrl:'https://eu-18.leanix.net/DavidHalbBTMDemo/inventory?type=Application',
        docTitle:'The Gartner TIME model in 2 minutes',
        docWhy:'TIME classifies every application into four buckets that drive your roadmap.',
        docSteps:['T — Tolerate: keep for now, no investment','I — Invest: strategic, enhance and grow','M — Migrate: move to new platform (e.g. S/4HANA)','E — Eliminate: retire, no replacement needed','Start with your top 20 most critical apps'],
        docLink:'https://help.sap.com/docs/leanix/ea/time',
        docLinkLabel:'TIME framework guide →',
      },
      { id:'e3', active:w=>w.appCount>0&&w.timePct>=30&&w.ifaceCount===0, done:w=>w.ifaceCount>0,
        title:'Document ERP interfaces',
        why:'Dependencies are what make transformation sequences realistic.',
        time:'2–3 hours for the most critical integrations',
        context:'ERP interfaces are the dependencies that determine migration complexity.',
        actionLabel:'New Fact Sheet → Interface',
        actionUrl:'https://eu-18.leanix.net/DavidHalbBTMDemo/inventory?type=Interface',
        docTitle:'Modeling ERP interfaces in LeanIX',
        docWhy:'Each interface is a data flow between two systems — the basis for migration planning.',
        docSteps:['Go to Inventory → New Fact Sheet → Interface','Name it: Source ↔ Target — data type','Set type: API, File, Database, or Messaging','Set direction: inbound, outbound, or both','Link source and target Applications in Relations'],
        docLink:'https://help.sap.com/docs/leanix/ea/interface-modeling-guidelines',
        docLinkLabel:'Interface modeling guide →',
      },
      { id:'e4', active:w=>w.appCount>0&&w.timePct>=30&&w.ifaceCount>0, done:()=>false,
        isFinish:true, title:'Create transformation initiative & roadmap',
        context:'Your transformation scope is visible. Create an initiative to turn TIME into a real roadmap.',
        actionLabel:'Open Roadmap Report',
        actionUrl:'https://eu-18.leanix.net/DavidHalbBTMDemo/reporting/timeline',
      },
    ],
    aiagents: [
      { id:'ag1', active:w=>w.appCount===0, done:w=>w.appCount>0,
        title:'Import your applications first',
        why:'AI agents are modeled as an Application subtype — they live in the same inventory.',
        context:'Before logging AI agents, bring in your regular application inventory. This gives the agents business context — which teams use them, which capabilities they serve.',
        actionLabel:'Go to Inventory → Import',
        actionUrl:'https://eu-18.leanix.net/DavidHalbBTMDemo/inventory',
        docTitle:'Importing applications via Excel',
        docWhy:'The fastest way to bring in a bulk list — no manual entry needed.',
        docSteps:['Go to Inventory → Inventory Tools → Import','Download the Application import template','Fill in: Name, Lifecycle status, Owner','Upload and confirm','Focus first on apps that use or embed AI agents'],
        docLink:'https://help.sap.com/docs/leanix/ea/importing-fact-sheet-data-through-excel-file',
        docLinkLabel:'Import guide →',
      },
      { id:'ag2', active:w=>w.appCount>0&&w.itcCount===0, done:w=>w.itcCount>0,
        title:'Add AI agents as fact sheets',
        why:'Each AI agent gets its own fact sheet — subtype: AI Agent. This is the inventory that enables governance.',
        time:'1–2 hours for a first pass of known agents',
        context:'In LeanIX, AI agents are a subtype of Application — not IT Components. Create one fact sheet per agent, set subtype to AI Agent, and capture the owner and the LLM it runs on.',
        actionLabel:'New Fact Sheet → Application → AI Agent',
        actionUrl:'https://eu-18.leanix.net/DavidHalbBTMDemo/inventory?type=Application',
        docTitle:'Modeling AI agents in LeanIX',
        docWhy:'AI agents are classified as Application subtypes — they support business tasks, not just infrastructure.',
        docSteps:['Go to Inventory → New Fact Sheet → Application','Set subtype: AI Agent','Name it clearly (e.g. "Customer Support Bot — Salesforce")','Set owner: who is accountable for this agent?','Link the underlying IT Component (the LLM model) in Relations'],
        docLink:'https://help.sap.com/docs/LEANIX/72d375467c1e4dcb872dfa2998b6328d/fb179359a91d4ca2b09d346f52e94784.html',
        docLinkLabel:'AI Agent Modeling Guidelines →',
      },
      { id:'ag3', active:w=>w.appCount>0&&w.itcCount>0&&w.bcCount===0, done:w=>w.bcCount>0,
        title:'Map agents to business capabilities',
        why:'Without BC links you can only list agents — you cannot answer which business functions are AI-enabled.',
        time:'20–30 min',
        context:'Link each AI agent to the business capability it supports. This turns the inventory into a governance map.',
        actionLabel:'Set up business capabilities',
        actionUrl:'https://eu-18.leanix.net/DavidHalbBTMDemo/inventory?type=BusinessCapability',
        docTitle:'Linking agents to business capabilities',
        docWhy:'The BC relation is what lets you ask: which functions are AI-enabled, and which have no agent coverage yet?',
        docSteps:['Open an AI Agent fact sheet','Go to the Relations tab','Click + Add → select the Business Capability it serves','Repeat for each agent','Use the Landscape report to visualize coverage'],
        docLink:'https://help.sap.com/docs/leanix/ea/business-capability-modeling-guidelines',
        docLinkLabel:'BC Modeling Guidelines →',
      },
      { id:'ag4', active:w=>w.appCount>0&&w.itcCount>0&&w.bcCount>0, done:()=>false,
        isFinish:true,
        title:'Open AI Agent Landscape',
        context:'Your AI agent inventory is ready. See which capabilities are AI-enabled, who owns each agent, and which agents lack governance.',
        actionLabel:'Open Technology Landscape',
        actionUrl:'https://eu-18.leanix.net/DavidHalbBTMDemo/reporting/landscape',
      },
    ],
    obsolescence: [
      { id:'ob1', active:w=>w.appCount===0, done:w=>w.appCount>0,
        title:'Import your application landscape',
        why:'Obsolescence risk is assessed in the context of business impact — you need the apps first.',
        context:'Import your applications so you can link them to the IT components that need lifecycle monitoring.',
        actionLabel:'Go to Inventory → Import',
        actionUrl:'https://eu-18.leanix.net/DavidHalbBTMDemo/inventory',
        docTitle:'Importing applications via Excel',
        docWhy:'A 20–30 app list is enough to start your risk map.',
        docSteps:['Go to Inventory → Inventory Tools → Import','Download the Application import template','Fill in: Name, Lifecycle status, Owner','Upload and confirm','Focus on business-critical and customer-facing apps first'],
        docLink:'https://help.sap.com/docs/leanix/ea/importing-fact-sheet-data-through-excel-file',
        docLinkLabel:'Import guide →',
      },
      { id:'ob2', active:w=>w.appCount>0&&w.itcCount===0, done:w=>w.itcCount>0,
        title:'Build your IT component inventory',
        why:'Obsolescence risk lives at the IT component layer — databases, middleware, OS versions, SaaS tools.',
        time:'2–3 hours for key technology components',
        context:'IT components are the technology your apps run on. End-of-life dates on these components are what the Obsolescence Risk dashboard is built from.',
        actionLabel:'New Fact Sheet → IT Component',
        actionUrl:'https://eu-18.leanix.net/DavidHalbBTMDemo/inventory?type=ITComponent',
        docTitle:'Building your IT component inventory',
        docWhy:'For each IT component, set the End of Maintenance and End of Life dates — these are the signals LeanIX uses to flag risk.',
        docSteps:['Go to Inventory → New Fact Sheet → IT Component','Set Tech Category (Software, SaaS, IaaS, etc.)','Set vendor + product name + version','Set lifecycle: End of Maintenance date and End of Life date','Use the Reference Catalog for SAP components — lifecycle data is pre-populated'],
        docLink:'https://help.sap.com/docs/leanix/ea/getting-started-building-your-it-component-inventory',
        docLinkLabel:'IT Component guide →',
      },
      { id:'ob3', active:w=>w.appCount>0&&w.itcCount>0&&w.relCount===0, done:w=>w.relCount>0,
        title:'Link applications to their technology',
        why:'The risk dashboard scores components by business criticality of the apps that depend on them — without links, every component looks equally risky.',
        countFn:w=>w.appCount>0?w.appCount+' apps unlinked':null,
        context:'Connect apps to the IT components they run on. This is what lets you prioritize: an end-of-life DB under a mission-critical app is a P1. The same DB under a retired app is not.',
        actionLabel:'Open Application → Relations',
        actionUrl:'https://eu-18.leanix.net/DavidHalbBTMDemo/inventory?type=Application',
        docTitle:'Linking applications to IT components',
        docWhy:'The "runs on" relation maps an application to its technology stack and drives risk prioritization.',
        docSteps:['Open an Application fact sheet','Go to Relations → Technical Stack','Click + Add → select the IT Component','Repeat for each dependency','Use bulk import for large landscapes'],
        docLink:'https://help.sap.com/docs/leanix/ea/bulk-updating-data-in-inventory-table-view',
        docLinkLabel:'Bulk relation import →',
      },
      { id:'ob4', active:w=>w.appCount>0&&w.itcCount>0&&w.relCount>0, done:()=>false,
        isFinish:true,
        title:'Open Obsolescence Risk Dashboard',
        context:'Your technology risk map is ready. See which components are end-of-life, which applications depend on them, and where to act first.',
        actionLabel:'Open Obsolescence Risk Dashboard',
        actionUrl:'https://eu-18.leanix.net/DavidHalbBTMDemo/reporting/landscape',
      },
    ],
    costtransparency: [
      { id:'ct1', active:w=>w.appCount===0, done:w=>w.appCount>0,
        title:'Import your applications',
        why:'Cost transparency starts with knowing which applications exist — costs attach to application fact sheets.',
        context:'Import your application landscape. For cost mapping, include the annual run cost and the owning business unit.',
        actionLabel:'Go to Inventory → Import',
        actionUrl:'https://eu-18.leanix.net/DavidHalbBTMDemo/inventory',
        docTitle:'Importing applications with cost data',
        docWhy:'The Excel import supports all standard fields including annual cost — fill it during the initial import.',
        docSteps:['Go to Inventory → Inventory Tools → Import','Download the Application import template','Fill in: Name, Owner, Annual Cost (if known)','Upload and confirm','Cost data can be enriched later via survey to app owners'],
        docLink:'https://help.sap.com/docs/leanix/ea/importing-fact-sheet-data-through-excel-file',
        docLinkLabel:'Import guide →',
      },
      { id:'ct2', active:w=>w.appCount>0&&w.bcCount===0, done:w=>w.bcCount>0,
        title:'Set up your organization structure',
        why:'Cost by business unit requires Organization fact sheets — without them, costs are unallocated.',
        time:'30–60 min',
        context:'Model your top-level business units as Organization fact sheets. Even a simple L1 structure (Finance, HR, Supply Chain, IT) is enough to start allocating costs.',
        actionLabel:'Go to Inventory → Organization',
        actionUrl:'https://eu-18.leanix.net/DavidHalbBTMDemo/inventory?type=Organization',
        docTitle:'Modeling your organization in LeanIX',
        docWhy:'Organizations represent the business units that own and use applications — the cost allocation layer.',
        docSteps:['Go to Inventory → New Fact Sheet → Organization','Set subtype: Business Unit','Name it as your official org unit name','Build L1 first (5–10 top-level units)','Add L2 departments only where cost granularity matters'],
        docLink:'https://help.sap.com/docs/leanix/ea/organization-modeling-guidelines',
        docLinkLabel:'Organization Modeling Guidelines →',
      },
      { id:'ct3', active:w=>w.appCount>0&&w.bcCount>0&&w.relCount===0, done:w=>w.relCount>0,
        title:'Link applications to business units',
        why:'The cost report is built on the app → organization relation — without it, every cost is unallocated.',
        countFn:w=>w.appCount>0?w.appCount+' apps unallocated':null,
        context:'Link each application to the business unit that owns and funds it. For shared services, link to the primary owner — sub-allocations can be refined later.',
        actionLabel:'Open Application → Relations',
        actionUrl:'https://eu-18.leanix.net/DavidHalbBTMDemo/inventory?type=Application',
        docTitle:'Allocating applications to business units',
        docWhy:'The "belongs to" relation is how LeanIX aggregates IT spend by organization.',
        docSteps:['Open an Application fact sheet','Go to Relations → Organization','Click + Add → select the owning business unit','For bulk allocation: use Excel import with sourceId/targetId','Check the Matrix report to see cost distribution taking shape'],
        docLink:'https://help.sap.com/docs/leanix/ea/bulk-updating-data-in-inventory-table-view',
        docLinkLabel:'Bulk relation import →',
      },
      { id:'ct4', active:w=>w.appCount>0&&w.bcCount>0&&w.relCount>0, done:()=>false,
        isFinish:true,
        title:'Open Cost by Business Unit view',
        context:'Your cost map is ready. See IT spend by business unit, identify the highest-cost capabilities, and find duplication candidates.',
        actionLabel:'Open Portfolio Matrix',
        actionUrl:'https://eu-18.leanix.net/DavidHalbBTMDemo/reporting/matrix',
      },
    ],
  };

  const FS_GUIDES = {
    application: {
      label:'Application', color:'#1b6dd2', letter:'A',
      definition:'Software systems that process business data and support business tasks. The central entities in LeanIX — they bridge business and IT.',
      whyItMatters:'All reports — Portfolio Matrix, Technology Landscape, Roadmap — are built around Applications.',
      fields:[
        {name:'Name',req:'must',desc:'The official system name.'},
        {name:'Lifecycle',req:'must',desc:'Active, Phase Out, End of Life, or Planned. Drives Matrix coloring and risk.'},
        {name:'Functional Fit',req:'must',desc:'How well the app supports its function (Excellent / Adequate / Insufficient / Unreasonable).'},
        {name:'Business Criticality',req:'must',desc:'Operational importance (Mission Critical / Business Critical / Business Operational / Administrative).'},
        {name:'Responsible',req:'should',desc:'The person accountable for this application data in LeanIX.'},
        {name:'Description',req:'should',desc:'One or two sentences on what the app does and who uses it.'},
        {name:'TIME',req:'nice',desc:'Transformation classification: Tolerate / Invest / Migrate / Eliminate.'},
      ],
      relations:[
        {from:'Application',arrow:'→ supports',to:'Business Capability'},
        {from:'Application',arrow:'→ belongs to',to:'Organization'},
        {from:'Application',arrow:'→ runs on',to:'IT Component'},
      ],
      examples:['SAP ECC 6.0','Salesforce CRM','Workday HR','Custom Inventory Portal'],
      docUrl:'https://help.sap.com/docs/leanix/ea/application-modeling-guidelines',
      docLabel:'Application Modeling Guidelines →',
    },
    bc: {
      label:'Business Capability', color:'#3fc380', letter:'BC',
      definition:'What your organization does — expressed as stable functions independent of technology or org structure.',
      whyItMatters:'BCs are the axes of the Portfolio Matrix. Without them you have a flat list. With them you can see overlap, gaps, and over/under-invested functions.',
      fields:[
        {name:'Name',req:'must',desc:'A business-oriented label (e.g. Order Management, not SAP SD Module).'},
        {name:'Description',req:'must',desc:'One sentence: what does this capability mean in your organization?'},
        {name:'Hierarchy Level',req:'must',desc:'L1 = major domain. L2 = sub-function. Aim for 7–20 L1 capabilities.'},
        {name:'Tags',req:'nice',desc:'Optional grouping (e.g. Core, Enabling, Customer-Facing).'},
      ],
      relations:[
        {from:'Business Capability',arrow:'← supported by',to:'Application'},
        {from:'Business Capability',arrow:'← owned by',to:'Organization'},
      ],
      examples:['Finance → Accounts Payable','Supply Chain → Demand Planning','HR → Talent Acquisition'],
      docUrl:'https://help.sap.com/docs/leanix/ea/business-capability-modeling-guidelines',
      docLabel:'BC Modeling Guidelines →',
      catalogUrl:'https://help.sap.com/docs/leanix/ea/business-capabilities-in-reference-catalog',
      catalogLabel:'Start with the SAP Reference Catalog →',
    },
    organization: {
      label:'Organization', color:'#e67e22', letter:'O',
      definition:'Your organization\'s hierarchical business structure — divisions, departments, business units, and teams.',
      whyItMatters:'Without Organizations you cannot answer who is responsible for this app or which BU has the most tech debt.',
      fields:[
        {name:'Name',req:'must',desc:'Official org unit name. Use the same naming as your HR system.'},
        {name:'Hierarchy Level',req:'must',desc:'L1 = top-level division. L2 = department. Mirror your actual org chart.'},
        {name:'Subtype',req:'should',desc:'Business Unit, Region, Legal Entity, Team, or Customer.'},
        {name:'Description',req:'nice',desc:'Brief description of the unit purpose.'},
      ],
      relations:[
        {from:'Organization',arrow:'→ uses',to:'Application'},
        {from:'Organization',arrow:'→ owns',to:'Business Capability'},
      ],
      examples:['Finance → Group Controlling','Supply Chain → Procurement','IT → Enterprise Architecture'],
      docUrl:'https://help.sap.com/docs/leanix/ea/organization-modeling-guidelines',
      docLabel:'Organization Modeling Guidelines →',
    },
  };

  // ── Build CSS ─────────────────────────────────────────────────────────
  const css = `
    .navbar-fixed-top { top: 35px !important; }
    #lx-demo-bar {
      position:fixed;top:0;left:0;right:0;z-index:99999;
      background:#1d2d3e;color:#fff;padding:5px 12px;
      font-size:11px;display:flex;align-items:center;gap:10px;
      flex-wrap:wrap;font-family:ui-sans-serif,system-ui,sans-serif;
      box-shadow:0 2px 8px rgba(0,0,0,0.3);
    }
    #lx-demo-bar strong{color:#f0ab00;}
    #lx-demo-bar label{display:flex;align-items:center;gap:3px;cursor:pointer;}
    #lx-demo-bar input{width:42px;padding:1px 3px;border-radius:3px;border:none;font-size:11px;background:#2d3e50;color:#fff;}
    #lx-demo-bar button{margin-left:auto;padding:3px 10px;border-radius:4px;border:none;background:#0a6ed1;color:#fff;cursor:pointer;font-size:11px;}
    #lx-guide-fab{position:fixed;bottom:32px;right:24px;width:44px;height:44px;border-radius:50%;background:#22c55e;border:none;cursor:pointer;z-index:99997;display:none;align-items:center;justify-content:center;box-shadow:0 2px 12px rgba(0,0,0,0.2);animation:lxbreathe 2.4s ease-in-out infinite;}
    #lx-guide-fab.show{display:flex;}
    #lx-guide-fab::after{content:'';position:absolute;inset:-5px;border-radius:50%;border:2px solid #22c55e;animation:lxring 2.4s ease-in-out infinite;}
    #lx-guide-fab svg{width:20px;height:20px;fill:#fff;pointer-events:none;}
    @keyframes lxbreathe{0%,100%{opacity:1;transform:scale(1);}50%{opacity:.7;transform:scale(.92);}}
    @keyframes lxring{0%,100%{opacity:.5;transform:scale(1);}50%{opacity:0;transform:scale(1.4);}}
    #lx-guide-root{position:fixed;top:87px;right:0;bottom:0;width:460px;z-index:99998;background:#fff;border-left:1px solid #d9d9d9;display:flex;flex-direction:column;font-family:"72","SAP 72",ui-sans-serif,system-ui,sans-serif;font-size:14px;box-shadow:-4px 0 24px rgba(0,0,0,0.12);transition:transform .25s ease;}
    #lx-guide-root.hide{transform:translateX(100%);}
    #lx-guide-root *{box-sizing:border-box;margin:0;padding:0;}
    #lx-guide-root a{color:#0a6ed1;text-decoration:none;}
    #lx-guide-root a:hover{text-decoration:underline;}
    #lx-ph{padding:18px 22px 14px;border-bottom:1px solid #e8e8e8;display:flex;align-items:flex-start;justify-content:space-between;flex-shrink:0;}
    #lx-ph h2{font-size:16px;font-weight:700;color:#1d2d3e;}
    #lx-ph p{font-size:13px;color:#556b82;margin-top:2px;}
    #lx-ph button{background:none;border:none;cursor:pointer;color:#556b82;font-size:18px;line-height:1;padding:0;flex-shrink:0;}
    #lx-tabs{display:none;flex-shrink:0;border-bottom:1px solid #e8e8e8;background:#f5f6f7;}
    #lx-tabs .lt{flex:1;padding:9px 0;text-align:center;font-size:12px;font-weight:600;color:#556b82;cursor:pointer;border-bottom:2px solid transparent;}
    #lx-tabs .lt:hover{color:#1d2d3e;}
    #lx-tabs .lt.on{color:#0a6ed1;border-bottom-color:#0a6ed1;background:#fff;}
    #lx-body{flex:1;overflow-y:auto;padding:18px 22px;}
    .lx-ic{border:1.5px solid #d9d9d9;border-radius:8px;padding:14px 16px;cursor:pointer;margin-bottom:10px;display:flex;align-items:flex-start;gap:12px;}
    .lx-ic:hover{border-color:#0a6ed1;background:#f0f7fe;}
    .lx-ic .ico{font-size:22px;flex-shrink:0;}
    .lx-ic .tit{font-size:14px;font-weight:700;color:#1d2d3e;margin-bottom:3px;}
    .lx-ic .desc{font-size:13px;color:#556b82;line-height:1.4;margin-bottom:6px;}
    .lx-ic .meta{display:flex;gap:12px;font-size:11px;color:#0a6ed1;font-weight:600;}
    .lx-prog-lbl{display:flex;justify-content:space-between;font-size:11px;color:#556b82;margin-bottom:6px;}
    .lx-prog-track{height:6px;background:#e8e8e8;border-radius:3px;overflow:hidden;margin-bottom:14px;}
    .lx-prog-fill{height:100%;background:#0a6ed1;border-radius:3px;transition:width .4s;}
    .lx-target{background:#e8f3fd;border:1px solid #b0d4f5;border-radius:6px;padding:10px 12px;margin-bottom:14px;font-size:12px;color:#1d2d3e;}
    .lx-target strong{display:block;color:#0a6ed1;margin-bottom:2px;font-size:11px;text-transform:uppercase;letter-spacing:.5px;}
    .lx-nudge{background:#fff8e6;border:1px solid #f0c050;border-radius:6px;padding:10px 12px;margin-bottom:8px;font-size:12px;color:#1d2d3e;display:flex;align-items:flex-start;gap:8px;}
    .lx-nudge a{display:inline-block;margin-top:6px;border:1px solid #e5a000;color:#8c5c00;padding:3px 10px;border-radius:4px;font-size:11px;font-weight:600;}
    .lx-step{border:1px solid #e8e8e8;border-radius:8px;margin-bottom:8px;overflow:hidden;}
    .lx-step.act{border-color:#0a6ed1;}
    .lx-step.don{opacity:.55;}
    .lx-step.blk{opacity:.4;pointer-events:none;}
    .lx-sh{padding:16px 18px;display:flex;align-items:center;gap:10px;cursor:pointer;user-select:none;}
    .lx-ss{width:22px;height:22px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;}
    .lx-ss.todo{background:#e8e8e8;color:#556b82;}
    .lx-ss.cur{background:#0a6ed1;color:#fff;}
    .lx-ss.done{background:#188918;color:#fff;}
    .lx-ss.lck{background:#e8e8e8;color:#bbb;}
    .lx-stb{flex:1;}
    .lx-stit{font-size:14px;font-weight:600;color:#1d2d3e;}
    .lx-swhy{font-size:11px;color:#0a6ed1;margin-top:2px;font-style:italic;}
    .lx-step.don .lx-stit{color:#888;}
    .lx-cnt{font-size:11px;color:#e76500;font-weight:700;white-space:nowrap;}
    .lx-chv{font-size:10px;color:#aaa;transition:transform .2s;}
    .lx-chv.op{transform:rotate(90deg);}
    .lx-sb{padding:0 18px 20px !important;display:none;border-top:1px solid #f0f0f0;padding-top:16px !important;}
    .lx-sb.op{display:block;}
    .lx-ctx{font-size:14px !important;color:#556b82 !important;margin-bottom:16px !important;line-height:1.8 !important;}
    .lx-time{font-size:13px !important;color:#556b82 !important;margin-bottom:16px !important;}
    .lx-act-btn{display:inline-flex;align-items:center;background:#0a6ed1;color:#fff!important;padding:9px 18px;border-radius:6px;font-size:13px;font-weight:600;margin-bottom:18px;text-decoration:none!important;}
    .lx-act-btn:hover{background:#085caf;}
    .lx-doc{background:#f8f9fa !important;border:1px solid #e8e8e8 !important;border-radius:8px !important;padding:18px 20px !important;font-size:13px !important;}
    .lx-doc .dt{font-weight:700;color:#1d2d3e;margin-bottom:6px;}
    .lx-doc .dw{color:#556b82 !important;margin-bottom:14px !important;line-height:1.8 !important;}
    .lx-doc ol{padding-left:22px !important;color:#1d2d3e !important;line-height:2.0 !important;margin-bottom:12px !important;}
    .lx-doc li{margin-bottom:10px !important;padding-top:4px !important;}
    .lx-doc a{display:inline-flex;align-items:center;gap:4px;margin-top:10px;font-size:12px;color:#0a6ed1;font-weight:600;}
    .lx-done-state{text-align:center;padding:24px 16px;}
    .lx-done-state .ck{font-size:40px;margin-bottom:10px;}
    .lx-done-state h3{font-size:15px;font-weight:700;margin-bottom:6px;color:#1d2d3e;}
    .lx-done-state p{font-size:12px;color:#556b82;line-height:1.5;margin-bottom:14px;}
    .lx-open-btn{display:inline-flex;align-items:center;background:#0a6ed1;color:#fff!important;padding:8px 18px;border-radius:4px;font-size:13px;font-weight:600;text-decoration:none!important;}
    .lx-upsell{margin-top:14px;background:#f0f7fe;border:1px solid #b0d4f5;border-radius:6px;padding:10px 12px;font-size:12px;color:#1d2d3e;}
    .lx-book{background:#f5f6f7;border:1px dashed #c0c8d0;border-radius:6px;padding:12px 14px;text-align:center;margin-top:12px;font-size:12px;color:#556b82;line-height:1.5;}
    .lx-book a{display:inline-block;margin-top:6px;padding:5px 14px;background:#fff;border:1px solid #0a6ed1;border-radius:4px;color:#0a6ed1;font-weight:600;font-size:12px;}
    .lx-change{display:block;text-align:center;margin-top:16px;font-size:11px;color:#556b82;cursor:pointer;background:none;border:none;width:100%;}
    .lx-fs-sel{display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap;}
    .lx-fs-btn{padding:5px 12px;border-radius:14px;font-size:12px;font-weight:600;cursor:pointer;border:1.5px solid #d9d9d9;background:#fff;color:#556b82;}
    .lx-fs-btn:hover{border-color:#0a6ed1;color:#0a6ed1;}
    .lx-fs-btn.on{background:#0a6ed1;color:#fff;border-color:#0a6ed1;}
    .lx-fsd{background:#f0f7fe;border:1px solid #b0d4f5;border-radius:6px;padding:10px 12px;margin-bottom:10px;}
    .lx-fsd-tit{font-size:13px;font-weight:700;color:#1d2d3e;margin-bottom:4px;display:flex;align-items:center;gap:8px;}
    .lx-fsd-ico{width:22px;height:22px;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:#fff;flex-shrink:0;}
    .lx-fsd p{font-size:12px;color:#1d2d3e;line-height:1.5;}
    .lx-fswhy{font-size:12px;color:#1d2d3e;background:#fff8e6;border:1px solid #f0c050;border-radius:6px;padding:8px 10px;line-height:1.5;margin-bottom:10px;}
    .lx-fswhy strong{color:#8c5c00;}
    .lx-fsh{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#556b82;margin:10px 0 6px;}
    .lx-ff{display:flex;gap:8px;padding:7px 0;border-bottom:1px solid #f0f0f0;font-size:12px;}
    .lx-ff:last-child{border-bottom:none;}
    .lx-ffn{width:110px;flex-shrink:0;font-weight:600;color:#1d2d3e;}
    .lx-ffr{font-size:10px;font-weight:700;padding:1px 5px;border-radius:3px;height:fit-content;white-space:nowrap;flex-shrink:0;margin-top:2px;}
    .lx-ffr.must{background:#fce8e8;color:#bb0000;}
    .lx-ffr.should{background:#fff3e0;color:#e76500;}
    .lx-ffr.nice{background:#f0f0f0;color:#556b82;}
    .lx-ffd{flex:1;color:#556b82;line-height:1.4;}
    .lx-fr{display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid #f0f0f0;font-size:12px;}
    .lx-fr:last-child{border-bottom:none;}
    .lx-frf{font-weight:600;color:#1d2d3e;}
    .lx-fra{color:#0a6ed1;font-weight:700;flex-shrink:0;}
    .lx-frt{color:#556b82;flex:1;}
    .lx-fex{background:#f8f9fa;border:1px solid #e8e8e8;border-radius:6px;padding:10px 12px;margin-top:10px;font-size:12px;}
    .lx-fex-tit{font-weight:700;color:#1d2d3e;margin-bottom:6px;}
    .lx-fex ul{padding-left:16px;color:#556b82;line-height:1.8;}
    .lx-flink{display:block;margin-top:10px;font-size:11px;font-weight:600;color:#0a6ed1;}
    .lx-q{font-size:14px;font-weight:600;color:#1d2d3e;margin-bottom:4px;}
    .lx-qs{font-size:13px;color:#556b82;margin-bottom:12px;line-height:1.4;}
  `;
  const styleEl = el('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // ── Build static DOM ──────────────────────────────────────────────────
  // Demo bar
  const demoBar = el('div', {id:'lx-demo-bar'});
  append(demoBar, el('strong', {text:'🎛 Demo'}));
  [['lx-ctrl-apps','Apps',0,500],['lx-ctrl-bcs','BCs',0,200],['lx-ctrl-rel','App→BC',0,500],
   ['lx-ctrl-itc','ITC',0,300],['lx-ctrl-iface','Iface',0,200],['lx-ctrl-users','Users',1,50],
   ['lx-ctrl-ff','FF%',0,100],['lx-ctrl-owners','Own%',0,100],['lx-ctrl-time','TIME%',0,100],['lx-ctrl-days','Days',1,90]
  ].forEach(([id, label, min, max]) => {
    const lbl = el('label');
    lbl.appendChild(txt(label + ' '));
    const inp = el('input', {type:'number', id, min:String(min), max:String(max), value:id==='lx-ctrl-users'?'1':'0'});
    lbl.appendChild(inp);
    demoBar.appendChild(lbl);
  });
  const licLbl = el('label');
  licLbl.appendChild(txt('Limit '));
  licLbl.appendChild(el('input', {type:'number', id:'lx-ctrl-limit', min:'10', max:'10000', value:'500'}));
  demoBar.appendChild(licLbl);
  const applyBtn = el('button', {text:'↺ Apply'});
  applyBtn.addEventListener('click', applyControls, true);
  demoBar.appendChild(applyBtn);
  document.body.insertBefore(demoBar, document.body.firstChild);

  // Panel
  const root = el('div', {id:'lx-guide-root'});

  const ph = el('div', {id:'lx-ph'});
  const phLeft = el('div');
  const titleEl = el('h2', {text:'Getting Started'});
  const subtitleEl = el('p', {text:'Tell us what you need to show'});
  phLeft.appendChild(titleEl); phLeft.appendChild(subtitleEl);
  const xBtn = el('button', {text:'✕'});
  xBtn.addEventListener('click', togglePanel, true);
  ph.appendChild(phLeft); ph.appendChild(xBtn);
  root.appendChild(ph);

  const tabs = el('div', {id:'lx-tabs'});
  const tabJ = el('div', {cls:'lt on', 'data-tab':'journey', text:'Journey to Goal'});
  const tabG = el('div', {cls:'lt', 'data-tab':'guides', text:'Factsheet Guides'});
  tabJ.addEventListener('click', () => switchTab('journey'), true);
  tabG.addEventListener('click', () => switchTab('guides'), true);
  tabs.appendChild(tabJ); tabs.appendChild(tabG);
  root.appendChild(tabs);

  const body = el('div', {id:'lx-body'});
  root.appendChild(body);
  document.body.appendChild(root);

  // FAB
  const fab = el('button', {id:'lx-guide-fab', title:'Open Getting Started guide'});
  const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox','0 0 24 24');
  const path = document.createElementNS('http://www.w3.org/2000/svg','path');
  path.setAttribute('d','M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 15h-2v-6h2zm0-8h-2V7h2z');
  svg.appendChild(path); fab.appendChild(svg);
  fab.addEventListener('click', togglePanel, true);
  document.body.appendChild(fab);

  // ── Core functions ────────────────────────────────────────────────────
  function togglePanel() {
    panelOpen = !panelOpen;
    root.classList.toggle('hide', !panelOpen);
    fab.classList.toggle('show', !panelOpen);
  }

  function switchTab(tab) {
    activeTab = tab;
    tabJ.classList.toggle('on', tab==='journey');
    tabG.classList.toggle('on', tab==='guides');
    tabs.style.display = 'flex';
    if (tab === 'journey') renderPanel(); else renderFsGuides();
  }

  function applyControls() {
    const g = id => parseInt(document.getElementById(id).value)||0;
    ws.appCount=g('lx-ctrl-apps'); ws.bcCount=g('lx-ctrl-bcs');
    ws.relCount=g('lx-ctrl-rel'); ws.itcCount=g('lx-ctrl-itc');
    ws.ifaceCount=g('lx-ctrl-iface'); ws.userCount=g('lx-ctrl-users')||1;
    ws.functFitPct=g('lx-ctrl-ff'); ws.ownersPct=g('lx-ctrl-owners');
    ws.timePct=g('lx-ctrl-time'); ws.daysSinceStart=g('lx-ctrl-days')||1;
    ws.licenseLimit=g('lx-ctrl-limit')||500;
    renderPanel();
  }

  function getProgress() {
    if (!selectedIntent) return 0;
    const rules = RULES[selectedIntent];
    return Math.round(rules.filter(r=>r.done(ws)).length / rules.length * 100);
  }

  function getNudges() {
    const n = [];
    if (ws.userCount <= 1) n.push({icon:'👥', text:'Your workspace has only 1 user. Invite your core team (2–5 people).', label:'Set up SSO or invite users', url:'https://help.sap.com/docs/leanix/ea/sso-configuration-process'});
    if (ws.appCount > 10 && ws.ownersPct < 30) n.push({icon:'📋', text:'Most applications have no owner assigned. Data quality will stall.', label:'Learn about subscription roles', url:'https://help.sap.com/docs/leanix/ea/subscription-roles'});
    if (ws.daysSinceStart > 14 && getProgress() < 25) n.push({icon:'🙋', text:'Looks like you are working through a blocker. Book a session with the onboarding team.', label:'Book a session', url:'https://support.sap.com/en/product/onboarding-resource-center/leanix.html'});
    return n;
  }

  // ── Render ────────────────────────────────────────────────────────────
  function clearBody() {
    while (body.firstChild) body.removeChild(body.firstChild);
  }

  function renderPanel() {
    clearBody();
    tabs.style.display = selectedIntent ? 'flex' : 'none';

    if (!selectedIntent) {
      titleEl.textContent = 'Getting Started';
      subtitleEl.textContent = 'Tell us what you need to show';

      const qTitle = el('p', {text:'What do you need to show — and to whom?'});
      qTitle.style.cssText = 'font-size:15px;font-weight:700;color:#1d2d3e;margin-bottom:8px;line-height:1.4;';
      body.appendChild(qTitle);

      const qSub = el('p', {text:'Pick your goal — we will reverse-engineer exactly what data you need and how far you are from your first result.'});
      qSub.style.cssText = 'font-size:13px;color:#556b82;margin-bottom:20px;line-height:1.6;';
      body.appendChild(qSub);

      Object.values(INTENTS).forEach(intent => {
        const card = el('div');
        card.style.cssText = 'border:1.5px solid #e0e0e0;border-radius:12px;padding:18px 20px;cursor:pointer;margin-bottom:14px;display:flex;align-items:flex-start;gap:16px;transition:border-color .15s,background .15s;';
        card.addEventListener('mouseenter', () => { card.style.borderColor='#0a6ed1'; card.style.background='#f0f7fe'; }, true);
        card.addEventListener('mouseleave', () => { card.style.borderColor='#e0e0e0'; card.style.background=''; }, true);

        const ico = el('div', {text:intent.icon});
        ico.style.cssText = 'font-size:28px;flex-shrink:0;margin-top:2px;line-height:1;';
        card.appendChild(ico);

        const info = el('div');
        info.style.cssText = 'flex:1;min-width:0;';

        const title = el('div', {text:intent.title});
        title.style.cssText = 'font-size:15px;font-weight:700;color:#1d2d3e;margin-bottom:6px;line-height:1.3;';
        info.appendChild(title);

        const desc = el('div', {text:intent.jobStatement});
        desc.style.cssText = 'font-size:13px;color:#556b82;line-height:1.6;margin-bottom:10px;';
        info.appendChild(desc);

        const meta = el('div');
        meta.style.cssText = 'display:flex;gap:16px;flex-wrap:wrap;';

        const aud = el('span', {text:'👤 ' + intent.audience});
        aud.style.cssText = 'font-size:12px;color:#0a6ed1;font-weight:600;';
        const time = el('span', {text:'⌛ ' + intent.timeToResult});
        time.style.cssText = 'font-size:12px;color:#0a6ed1;font-weight:600;';
        meta.appendChild(aud); meta.appendChild(time);
        info.appendChild(meta);

        card.appendChild(info);
        card.addEventListener('click', () => { selectedIntent = intent.id; renderPanel(); }, true);
        body.appendChild(card);
      });
      return;
    }

    const intent = INTENTS[selectedIntent];
    const rules = RULES[selectedIntent];
    const progress = getProgress();
    const currentRule = rules.find(r => r.active(ws));
    const isComplete = rules.every(r => r.done(ws)) || (currentRule && currentRule.isFinish);
    const remaining = rules.filter(r => !r.done(ws) && !r.isFinish).length;

    titleEl.textContent = intent.title;
    subtitleEl.textContent = progress > 0 ? remaining + ' step' + (remaining!==1?'s':'') + ' to first result' : '~' + intent.timeToResult + ' to first result';

    // Progress
    const progLbl = el('div');
    progLbl.style.cssText = 'display:flex;justify-content:space-between;font-size:13px;color:#556b82;margin-bottom:8px;';
    progLbl.appendChild(txt('Distance to '));
    const progStrong = el('strong', {text:intent.targetReport});
    progStrong.style.cssText = 'color:#1d2d3e;margin:0 4px;';
    progLbl.appendChild(progStrong);
    progLbl.appendChild(el('span', {text:' — ' + progress + '%'}));
    body.appendChild(progLbl);
    const track = el('div');
    track.style.cssText = 'height:7px;background:#e8e8e8;border-radius:4px;overflow:hidden;margin-bottom:18px;';
    const fill = el('div');
    fill.style.cssText = 'height:100%;background:#0a6ed1;border-radius:4px;width:' + progress + '%;';
    track.appendChild(fill); body.appendChild(track);

    // License consumption bar
    if (ws.licenseLimit > 0) {
      const licPct = Math.min(100, Math.round(ws.appCount / ws.licenseLimit * 100));
      const licColor = licPct > 85 ? '#bb0000' : licPct > 60 ? '#e76500' : '#188918';
      const licBar = el('div');
      licBar.style.cssText = 'background:#f5f6f7;border:1px solid #e8e8e8;border-radius:8px;padding:10px 14px;margin-bottom:16px;';
      const licTop = el('div');
      licTop.style.cssText = 'display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px;';
      const licLabel = el('div', {text:'Application licence usage'});
      licLabel.style.cssText = 'color:#556b82;font-weight:600;';
      const licCount = el('div', {text: ws.appCount + ' / ' + ws.licenseLimit});
      licCount.style.cssText = 'color:' + licColor + ';font-weight:700;';
      licTop.appendChild(licLabel); licTop.appendChild(licCount);
      const licTrack = el('div');
      licTrack.style.cssText = 'height:6px;background:#e8e8e8;border-radius:3px;overflow:hidden;';
      const licFill = el('div');
      licFill.style.cssText = 'height:100%;border-radius:3px;width:' + licPct + '%;background:' + licColor + ';transition:width .4s;';
      licTrack.appendChild(licFill);
      licBar.appendChild(licTop); licBar.appendChild(licTrack);
      body.appendChild(licBar);
    }

    // Target
    const target = el('div');
    target.style.cssText = 'background:#e8f3fd;border:1px solid #b0d4f5;border-radius:8px;padding:14px 16px;margin-bottom:18px;line-height:1.7;';
    const tStrong = el('strong', {text:'Your deliverable → ' + intent.targetReport});
    tStrong.style.cssText = 'display:block;color:#0a6ed1;margin-bottom:6px;font-size:11px;text-transform:uppercase;letter-spacing:.5px;';
    target.appendChild(tStrong);
    const tDesc = el('div', {text:intent.targetReportDesc});
    tDesc.style.cssText = 'font-size:14px;color:#1d2d3e;margin-bottom:8px;line-height:1.6;';
    target.appendChild(tDesc);
    const aud = el('div', {text:'👤 Share with: ' + intent.audience});
    aud.style.cssText = 'font-size:13px;color:#556b82;';
    target.appendChild(aud);
    body.appendChild(target);

    // Nudges
    getNudges().forEach(n => {
      const nudge = el('div');
      nudge.style.cssText = 'background:#fff8e6;border:1px solid #f0c050;border-radius:8px;padding:14px 16px;margin-bottom:12px;display:flex;align-items:flex-start;gap:12px;line-height:1.6;';
      const icon = el('span', {text:n.icon});
      icon.style.cssText = 'font-size:18px;flex-shrink:0;';
      nudge.appendChild(icon);
      const nt = el('div');
      nt.style.cssText = 'font-size:14px;color:#1d2d3e;';
      nt.appendChild(txt(n.text));
      nt.appendChild(el('br'));
      const nl = a(n.url, n.label + ' ↗');
      nl.style.cssText = 'display:inline-block;margin-top:8px;border:1px solid #e5a000;color:#8c5c00;padding:5px 12px;border-radius:4px;font-size:13px;font-weight:600;text-decoration:none;';
      nt.appendChild(nl);
      nudge.appendChild(nt);
      body.appendChild(nudge);
    });

    if (isComplete && !currentRule) {
      const done = el('div', {cls:'lx-done-state'});
      done.appendChild(el('div', {cls:'ck', text:'✅'}));
      done.appendChild(el('h3', {text:'Your ' + intent.targetReport + ' is ready'}));
      done.appendChild(el('p', {text:'You now have enough data. Share with ' + intent.audience + '.'}));
      done.appendChild(a(intent.targetReportUrl, 'Open ' + intent.targetReport + ' ↗'));
      done.querySelector('a').className = 'lx-open-btn';
      const upsell = el('div');
      upsell.style.cssText = 'margin-top:16px;background:#f0f7fe;border:1px solid #b0d4f5;border-radius:8px;padding:12px 14px;font-size:13px;color:#1d2d3e;line-height:1.6;';
      const upsellPrompt = intent.aiUpsell || 'The EA Assistant can answer follow-up questions about your data — ask in natural language, no manual analysis needed.';
      const upsellTitle = el('strong', {text:'Unlock the EA Assistant next: '});
      upsellTitle.style.cssText = 'color:#0a6ed1;';
      upsell.appendChild(upsellTitle);
      upsell.appendChild(txt(upsellPrompt));
      const upsellNote = el('div', {text:'Requires AI terms + AI Units.'});
      upsellNote.style.cssText = 'margin-top:6px;font-size:12px;color:#888;';
      upsell.appendChild(upsellNote);
      done.appendChild(upsell);
      body.appendChild(done);
    } else {
      rules.forEach((rule, i) => {
        const isDone = rule.done(ws), isActive = rule.active(ws);
        const step = el('div', {cls:'lx-step ' + (isDone?'don':isActive?'act':'blk')});

        const sh = el('div', {cls:'lx-sh'});
        const ss = el('div', {cls:'lx-ss ' + (isDone?'done':isActive?'cur':'lck'), text:isDone?'✓':isActive?String(i+1):'·'});
        const stb = el('div', {cls:'lx-stb'});
        stb.appendChild(el('div', {cls:'lx-stit ' + (isDone?'don':''), text:rule.title}));
        if (rule.why && isActive) stb.appendChild(el('div', {cls:'lx-swhy', text:rule.why}));
        const cnt = rule.countFn ? rule.countFn(ws) : null;
        const chv = el('div', {cls:'lx-chv ' + (isActive?'op':''), text:'▶'});
        sh.appendChild(ss); sh.appendChild(stb);
        if (cnt) sh.appendChild(el('div', {cls:'lx-cnt', text:cnt}));
        sh.appendChild(chv);

        const sb = el('div', {cls:'lx-sb ' + (isActive?'op':'')});
        sb.style.cssText = 'padding:16px 18px 20px;display:' + (isActive?'block':'none') + ';border-top:1px solid #f0f0f0;';

        const ctxEl = el('div', {text:rule.context});
        ctxEl.style.cssText = 'font-size:14px;color:#556b82;margin-bottom:16px;line-height:1.8;';
        sb.appendChild(ctxEl);

        if (rule.time) {
          const timeEl = el('div', {text:'⌛ About ' + rule.time});
          timeEl.style.cssText = 'font-size:13px;color:#999;margin-bottom:16px;';
          sb.appendChild(timeEl);
        }

        const actLink = a(rule.actionUrl, rule.actionLabel + ' →');
        actLink.style.cssText = 'display:inline-flex;align-items:center;background:#0a6ed1;color:#fff;padding:10px 20px;border-radius:6px;font-size:14px;font-weight:600;margin-bottom:20px;text-decoration:none;';
        sb.appendChild(actLink);

        if (rule.docTitle) {
          const doc = el('div');
          doc.style.cssText = 'background:#f8f9fa;border:1px solid #e8e8e8;border-radius:8px;padding:18px 20px;';

          const dt = el('div', {text:rule.docTitle});
          dt.style.cssText = 'font-weight:700;color:#1d2d3e;margin-bottom:10px;font-size:14px;';
          doc.appendChild(dt);

          const dw = el('div', {text:rule.docWhy});
          dw.style.cssText = 'color:#777;margin-bottom:14px;line-height:1.7;font-size:13px;';
          doc.appendChild(dw);

          const ol = el('ol');
          ol.style.cssText = 'padding-left:22px;color:#1d2d3e;margin-bottom:14px;';
          rule.docSteps.forEach(s => {
            const li = el('li', {text:s});
            li.style.cssText = 'margin-bottom:10px;line-height:1.6;font-size:13px;';
            ol.appendChild(li);
          });
          doc.appendChild(ol);

          const dl = a(rule.docLink, '📄 ' + rule.docLinkLabel);
          dl.style.cssText = 'display:inline-block;margin-top:4px;font-size:13px;color:#0a6ed1;font-weight:600;';
          doc.appendChild(dl);
          if (rule.docLink2) {
            doc.appendChild(el('br'));
            const dl2 = a(rule.docLink2, '📄 ' + rule.docLink2Label);
            dl2.style.cssText = 'display:inline-block;margin-top:8px;font-size:13px;color:#0a6ed1;font-weight:600;';
            doc.appendChild(dl2);
          }
          sb.appendChild(doc);
        }

        sh.addEventListener('click', () => {
          const isOpen = sb.classList.contains('op');
          root.querySelectorAll('.lx-sb').forEach(s => s.classList.remove('op'));
          root.querySelectorAll('.lx-chv').forEach(c => c.classList.remove('op'));
          if (!isOpen) { sb.classList.add('op'); chv.classList.add('op'); }
        }, true);

        step.appendChild(sh); step.appendChild(sb);
        body.appendChild(step);
      });

      if (ws.daysSinceStart > 14 && progress < 50) {
        const book = el('div', {cls:'lx-book'});
        book.appendChild(txt('Working through a blocker? The onboarding team can join for a focused 30-min session.'));
        book.appendChild(el('br'));
        book.appendChild(a('https://support.sap.com/en/product/onboarding-resource-center/leanix.html', 'Book a session →'));
        body.appendChild(book);
      }
    }

    const chgBtn = el('button', {cls:'lx-change', text:'← Change my goal'});
    chgBtn.addEventListener('click', () => { selectedIntent = null; renderPanel(); }, true);
    body.appendChild(chgBtn);
  }

  function renderFsGuides() {
    clearBody();

    // Selector pills
    const sel = el('div');
    sel.style.cssText = 'display:flex;gap:8px;margin-bottom:18px;flex-wrap:wrap;';
    Object.values(FS_GUIDES).forEach(g => {
      const isOn = g.label === FS_GUIDES[activeFsGuide].label;
      const b = el('button', {text:g.label});
      b.style.cssText = 'padding:6px 14px;border-radius:14px;font-size:13px;font-weight:600;cursor:pointer;border:1.5px solid ' + (isOn?'#0a6ed1':'#d9d9d9') + ';background:' + (isOn?'#0a6ed1':'#fff') + ';color:' + (isOn?'#fff':'#556b82') + ';';
      b.addEventListener('click', () => { activeFsGuide = Object.keys(FS_GUIDES).find(k=>FS_GUIDES[k]===g); renderFsGuides(); }, true);
      sel.appendChild(b);
    });
    body.appendChild(sel);

    const g = FS_GUIDES[activeFsGuide];

    // Definition card
    const fsd = el('div');
    fsd.style.cssText = 'background:#e8f3fd;border:1px solid #b0d4f5;border-radius:8px;padding:14px 16px;margin-bottom:14px;';
    const fsdTit = el('div');
    fsdTit.style.cssText = 'font-size:15px;font-weight:700;color:#1d2d3e;margin-bottom:8px;display:flex;align-items:center;gap:10px;';
    const ico = el('div', {text:g.letter});
    ico.style.cssText = 'width:26px;height:26px;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:#fff;background:' + g.color + ';flex-shrink:0;';
    fsdTit.appendChild(ico); fsdTit.appendChild(txt(g.label));
    const defP = el('div', {text:g.definition});
    defP.style.cssText = 'font-size:14px;color:#1d2d3e;line-height:1.7;';
    fsd.appendChild(fsdTit); fsd.appendChild(defP);
    body.appendChild(fsd);

    // Why it matters
    const why = el('div');
    why.style.cssText = 'background:#fff8e6;border:1px solid #f0c050;border-radius:8px;padding:12px 16px;margin-bottom:18px;font-size:14px;color:#1d2d3e;line-height:1.7;';
    const whyStrong = el('strong', {text:'Why it matters: '});
    whyStrong.style.cssText = 'color:#8c5c00;';
    why.appendChild(whyStrong); why.appendChild(txt(g.whyItMatters));
    body.appendChild(why);

    // Section header helper
    function fsSection(label) {
      const h = el('div', {text:label});
      h.style.cssText = 'font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#556b82;margin:0 0 10px;';
      body.appendChild(h);
    }

    // Critical fields
    fsSection('Critical fields');
    const reqColors = {must:['#fce8e8','#bb0000'], should:['#fff3e0','#e76500'], nice:['#f0f0f0','#556b82']};
    g.fields.forEach((f, i) => {
      const row = el('div');
      row.style.cssText = 'display:flex;gap:10px;padding:10px 0;border-bottom:1px solid ' + (i<g.fields.length-1?'#f0f0f0':'transparent') + ';align-items:flex-start;';
      const name = el('div', {text:f.name});
      name.style.cssText = 'width:120px;flex-shrink:0;font-weight:600;color:#1d2d3e;font-size:14px;line-height:1.5;';
      const [bg, fg] = reqColors[f.req] || reqColors.nice;
      const req = el('div', {text:f.req==='must'?'Must':f.req==='should'?'Should':'Nice'});
      req.style.cssText = 'font-size:10px;font-weight:700;padding:2px 6px;border-radius:3px;background:' + bg + ';color:' + fg + ';white-space:nowrap;flex-shrink:0;margin-top:3px;';
      const desc = el('div', {text:f.desc});
      desc.style.cssText = 'flex:1;color:#556b82;font-size:13px;line-height:1.6;';
      row.appendChild(name); row.appendChild(req); row.appendChild(desc);
      body.appendChild(row);
    });

    // Key relations
    const relHeader = el('div', {text:'Key relations'});
    relHeader.style.cssText = 'font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#556b82;margin:18px 0 10px;';
    body.appendChild(relHeader);
    g.relations.forEach((r, i) => {
      const row = el('div');
      row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid ' + (i<g.relations.length-1?'#f0f0f0':'transparent') + ';font-size:14px;';
      const from = el('div', {text:r.from});
      from.style.cssText = 'font-weight:600;color:#1d2d3e;';
      const arrow = el('div', {text:r.arrow});
      arrow.style.cssText = 'color:#0a6ed1;font-weight:700;flex-shrink:0;';
      const to = el('div', {text:r.to});
      to.style.cssText = 'color:#556b82;flex:1;';
      row.appendChild(from); row.appendChild(arrow); row.appendChild(to);
      body.appendChild(row);
    });

    // Examples
    const ex = el('div');
    ex.style.cssText = 'background:#f8f9fa;border:1px solid #e8e8e8;border-radius:8px;padding:14px 16px;margin-top:18px;';
    const exTit = el('div', {text:'Examples'});
    exTit.style.cssText = 'font-weight:700;color:#1d2d3e;margin-bottom:10px;font-size:14px;';
    ex.appendChild(exTit);
    const ul = el('ul');
    ul.style.cssText = 'padding-left:20px;';
    g.examples.forEach(e => {
      const li = el('li', {text:e});
      li.style.cssText = 'color:#556b82;font-size:14px;line-height:1.8;margin-bottom:4px;';
      ul.appendChild(li);
    });
    ex.appendChild(ul);
    body.appendChild(ex);

    // Doc links
    const dl = a(g.docUrl, '📄 ' + g.docLabel);
    dl.style.cssText = 'display:block;margin-top:14px;font-size:13px;font-weight:600;color:#0a6ed1;';
    body.appendChild(dl);
    if (g.catalogUrl) {
      const cl = a(g.catalogUrl, '📚 ' + g.catalogLabel);
      cl.style.cssText = 'display:block;margin-top:8px;font-size:13px;font-weight:600;color:#0a6ed1;';
      body.appendChild(cl);
    }
  }

  // No wireBodyClicks needed — all listeners are set directly when nodes are created
  function wireBodyClicks() {} // no-op, kept for setContent compat

  // ── Nav button injection ──────────────────────────────────────────────
  function injectNavButton() {
    if (document.getElementById('lx-guide-trigger')) return;
    const navRight = document.querySelector('.right-section, [class*="right-section"], [class*="navbar-right"]');
    if (!navRight) return;
    const b = el('button', {id:'lx-guide-trigger', text:'● Getting Started'});
    b.style.cssText = 'display:inline-flex;align-items:center;gap:6px;background:#0a6ed1;color:#fff;font-size:12px;font-weight:600;padding:0 12px;height:28px;border-radius:14px;cursor:pointer;border:none;white-space:nowrap;font-family:inherit;margin-left:12px;';
    b.addEventListener('click', togglePanel, true);
    navRight.prepend(b);
  }

  // ── SPA navigation watcher ────────────────────────────────────────────
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) { lastUrl = location.href; setTimeout(injectNavButton, 800); }
  }).observe(document.body, {childList:true, subtree:true});

  // ── Live workspace count via GraphQL ────────────────────────────────
  function lxFetchCounts() {
    const workspace = location.pathname.split('/')[1];
    const host = location.hostname;
    fetch('https://' + host + '/' + workspace + '/graphql', {
      method: 'POST',
      credentials: 'include',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({query:`{
        allFactSheets(filter:{facetFilters:[{facetKey:"FactSheetTypes",operator:OR,keys:["Application","BusinessCapability","Organization","ITComponent","Interface"]}]}) {
          edges { node { __typename } }
        }
      }`})
    })
    .then(r => r.json())
    .then(data => {
      const edges = data?.data?.allFactSheets?.edges || [];
      const counts = {Application:0, BusinessCapability:0, Organization:0, ITComponent:0, Interface:0};
      edges.forEach(e => { const t = e.node.__typename; if (counts[t]!==undefined) counts[t]++; });
      ws.appCount = counts.Application;
      ws.bcCount = counts.BusinessCapability;
      ws.itcCount = counts.ITComponent;
      ws.ifaceCount = counts.Interface;
      // Update demo bar inputs to reflect live data
      ['apps','bcs','itc','iface'].forEach((key,i) => {
        const val = [ws.appCount, ws.bcCount, ws.itcCount, ws.ifaceCount][i];
        const inp = document.getElementById('lx-ctrl-' + key);
        if (inp) inp.value = val;
      });
      renderPanel();
    })
    .catch(() => {}); // silently ignore if API not reachable
  }

  // ── Boot ──────────────────────────────────────────────────────────────
  renderPanel();
  setTimeout(injectNavButton, 1200);
  setTimeout(lxFetchCounts, 1500);

})();

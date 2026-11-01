"use client";

import Link from "next/link";
import type { OracleSnapshot } from "@/lib/oracle";
import { marketById } from "@/lib/markets";
import { Flag } from "./Flag";
import { WaitlistForm } from "./Markets";
import { PageHero, PageShell, SectionHead } from "./Site";
import { usd, useApi } from "./useApi";

const NAMES: Record<string, string> = { SPY: "S&P 500 ETF", QQQ: "नैस्डैक-100 ETF", GLD: "गोल्ड ETF", SLV: "सिल्वर ETF", IBIT: "बिटकॉइन ETF" };

const PRODUCTS = [
  { name: "Oracle (ओरेकल)", href: "/oracle", body: "हर मिनट SPY, QQQ, गोल्ड, सिल्वर और बिटकॉइन ETF टोकन की उचित कीमत, साथ में भरोसे का स्कोर (35 से 98)। फ़्यूचर्स, एशिया-यूरोप के बाज़ार और सेंटिमेंट से।" },
  { name: "Vault (वॉल्ट)", href: "/app", body: "ETF टोकन गिरवी रखकर USDG उधार लें, Morpho Blue के लिक्विडेशन नियमों पर। अभी पेपर मोड में; आगे Algorand TestNet पर।" },
  { name: "Guardian (गार्डियन)", href: "/app#guardian", body: "रात में कीमत गिरे तो लिक्विडेशन से पहले ही आपको चेतावनी या थोड़ा कोलैटरल बेचकर लोन की हेल्थ वापस ऊपर लाना।" },
  { name: "Cloak (क्लोक)", href: "/proof", body: "ज़ीरो-नॉलेज प्रूफ़: लोन पूरी तरह कोलैटरल से ढका है (हेल्थ फ़ैक्टर 1 से ऊपर), यह साबित करें, बिना उसका आकार बताए। प्रूफ़ आपके ब्राउज़र में बनता है।" },
  { name: "Ledger (लेजर)", href: "/scorecard", body: "हर कारोबारी दिन बाज़ार खुलने से पहले अनुमान Algorand पर दर्ज होता है, फिर असली ओपन से जाँचा जाता है। चूक भी दिखाई जाती है।" },
  { name: "Earn (अर्न)", href: "/#earn", body: "Sentora के PYUSD वॉल्ट (Ethereum) की लाइव यील्ड, सिर्फ़ देखने के लिए। जमा Sentora की साइट पर होता है।" },
];

/** A complete Hindi explainer (plan §8: content in English and Hindi), with the India market's rules and waitlist. */
export function HindiPage() {
  const { data: snap } = useApi<OracleSnapshot>("/api/oracle", 60_000);
  const india = marketById("india")!;
  return (
    <PageShell>
      <div lang="hi">
        <PageHero
          overline="NIGHTSHIFT · हिंदी में"
          title="शेयर बाज़ार शाम 4 बजे बंद होता है। टोकनाइज़्ड ETF नहीं।"
          lead="SPY, QQQ, गोल्ड और बिटकॉइन ETF जैसे टोकन ब्लॉकचेन पर चौबीसों घंटे चलते हैं, लेकिन वॉल स्ट्रीट बंद होते ही उनकी कीमत जम जाती है। Nightshift रात भर और वीकेंड पर भी उनकी उचित कीमत (fair value) बताता है, ताकि उन पर लिए गए लोन शुक्रवार के क्लोज़ की बजाय ताज़ा कीमत पर आँके जाएँ।"
        />
        <section className="block">
          <div className="wrap">
            <SectionHead overline="अभी की कीमतें" title="बाज़ार बंद है, फिर भी कीमत ताज़ा।" />
            <div className="table-wrap panel">
              <table>
                <thead>
                  <tr>
                    <th>टोकन</th>
                    <th className="num">उचित कीमत</th>
                    <th className="num">पिछले क्लोज़ से</th>
                    <th className="num">भरोसा</th>
                  </tr>
                </thead>
                <tbody>
                  {(snap?.quotes ?? []).map((q) => (
                    <tr key={q.token}>
                      <td>
                        <b className="mono">{q.token}</b> <span className="muted">{NAMES[q.token] ?? q.name}</span>
                      </td>
                      <td className="num">{usd(q.fairValue)}</td>
                      <td className={`num ${q.driftPct >= 0 ? "up" : "down"}`}>
                        {q.driftPct >= 0 ? "+" : "−"}
                        {Math.abs(q.driftPct).toFixed(2)}%
                      </td>
                      <td className="num">{q.confidence}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="xs muted sc-note">
              {snap ? `${snap.market.open ? "NYSE खुला है" : "NYSE बंद है"} · ${snap.market.etTime}` : "कीमतें लोड हो रही हैं…"} · भरोसा 35 से 98 के बीच होता है और बाज़ार
              जितनी देर बंद रहे, उतना घटता है। यह जानकारी है, निवेश सलाह नहीं।
            </p>
          </div>
        </section>

        <section className="block alt">
          <div className="wrap">
            <SectionHead overline="समस्या" title="सोमवार की सुबह का झटका।" />
            <div className="problem-grid">
              <div className="card problem">
                <h3>कीमतें पुरानी हो जाती हैं</h3>
                <p>टोकन 24/7 चलते हैं, पर पारंपरिक प्राइस फ़ीड शुक्रवार के क्लोज़ पर अटक जाती हैं।</p>
              </div>
              <div className="card problem">
                <h3>लोन सबको दिखते हैं</h3>
                <p>पब्लिक पोज़िशन बता देती है कि लिक्विडेशन ठीक किस कीमत पर होगा।</p>
              </div>
              <div className="card problem">
                <h3>वीकेंड की ख़बरें एक साथ</h3>
                <p>शनिवार-रविवार की ख़बरें सोमवार को ओपन पर एक झटके में कीमतों में आती हैं।</p>
              </div>
            </div>
          </div>
        </section>

        <section className="block">
          <div className="wrap">
            <SectionHead overline="प्रोडक्ट" title="एक लाइव कीमत, और उस पर बने छह हिस्से।" />
            <div className="hi-products">
              {PRODUCTS.map((p) => (
                <Link key={p.name} href={p.href} className="card hi-product">
                  <h3>{p.name}</h3>
                  <p>{p.body}</p>
                  <span>देखें →</span>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section className="block alt" id="india">
          <div className="wrap">
            <div className="card panel market-panel">
              <div className="market-panel-head">
                <span className="market-flag big"><Flag id="india" size={42} /></span>
                <div>
                  <span className="unit">भारत के लिए</span>
                  <h3>पहले डेटा और अलर्ट, लोन बाद में</h3>
                </div>
              </div>
              <div className="market-features">
                <div className="market-feature live">
                  <span className="unit">रात की कीमतें</span>
                  <b>लाइव</b>
                </div>
                <div className="market-feature soon">
                  <span className="unit">वीकेंड अलर्ट</span>
                  <b>जल्द आ रहा है</b>
                </div>
                <div className="market-feature soon">
                  <span className="unit">लोन</span>
                  <b>जल्द आ रहा है</b>
                </div>
              </div>
              <p className="market-legal">
                भारत के लिए सिर्फ़ डेटा। भारतीय निवासियों को लोन की सुविधा नहीं दी जाती। टोकनाइज़्ड स्टॉक भारत में रेगुलेटेड निवेश नहीं हैं। वर्चुअल डिजिटल
                एसेट से होने वाली आय पर 30% टैक्स और 4% सेस लगता है, और ज़्यादातर ट्रांसफ़र पर 1% TDS कटता है। यह निवेश या टैक्स सलाह नहीं है।
              </p>
              <p className="market-next">अब लाइव: इंडिया रिसर्च डेस्क (निफ़्टी 50 का प्री-ओपन अनुमान, 5 साल के बैकटेस्ट और भू-राजनीतिक न्यूज़ रडार)। आगे: Telegram और WhatsApp पर अलर्ट।</p>
              <a className="btn primary market-desk" href="/india">इंडिया रिसर्च डेस्क खोलें →</a>
              <WaitlistForm market={india} lang="hi" />
            </div>
          </div>
        </section>

        <section className="block">
          <div className="wrap">
            <p className="hi-disclaimer">
              यह एक डेमो है: सब कुछ Algorand TestNet और पेपर मोड पर चलता है, किसी मेननेट पर कुछ नहीं, और असली पैसा कहीं नहीं लगता।
              Nightshift कोई टोकन नहीं बेचता और आपके पैसे अपने पास नहीं रखता। Stock Tokens अमेरिकी नागरिकों/निवासियों के लिए उपलब्ध नहीं हैं। लोगो सिर्फ़
              तकनीकी इंटीग्रेशन दिखाते हैं, किसी साझेदारी या समर्थन का दावा नहीं।{" "}
              <Link href="/">English में देखें →</Link>
            </p>
          </div>
        </section>
      </div>
    </PageShell>
  );
}

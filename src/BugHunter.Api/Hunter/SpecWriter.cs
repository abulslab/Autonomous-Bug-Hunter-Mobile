using System.Text;
using System.Text.RegularExpressions;

namespace BugHunter.Api.Hunter;

// Turns the trajectory that led to a finding into an Appium (UiAutomator2) or Playwright test that replays it with no model involved.
// Locators come from what the element was (testTag/resource-id, accessibility label, text), not from the hunt's transient refs.
public static class SpecWriter
{
    static readonly string[] PlaywrightRoles = ["link", "button", "textbox", "searchbox", "spinbutton", "combobox", "checkbox", "radio", "tab", "menuitem", "option", "switch", "slider"];
    static readonly string[] FieldRoles = ["textbox", "searchbox", "spinbutton", "combobox"];
    static readonly string[] RejectOracles = ["invalid-input-accepted", "non-positive-qty", "duplicate-promotion", "oversell"];

    public static List<string> Repro(Hunt h, Finding f) =>
        Trail(h, f).Select(s => s.N == 0 ? $"Open {s.Action.Url}" : ModelHuntPolicy.Describe(s.Action, s.Target)).ToList();

    // The steps that lead to a finding: the shrunk set once it has been minimised, otherwise everything up to it.
    public static List<HuntStep> Trail(Hunt h, Finding f) =>
        h.Steps.Where(s => s.Ok && s.Blocked is null && (f.MinimalSteps is { } m ? s.N == 0 || m.Contains(s.N) : s.N <= f.Step)).ToList();

    // Generates an Appium WebdriverIO (UiAutomator2) test targeting the real Android APK on Pixel_8.
    public static string WriteAppium(Hunt h, Finding f)
    {
        var steps = Trail(h, f);
        var pkg = h.Url.Contains(":5291") || h.Url.Contains("hotel") ? "com.bughunter.mobile.hotel"
                : h.Url.Contains("voice") ? "com.bughunter.mobile.voice"
                : "com.bughunter.mobile.shop";
        var apk = pkg.EndsWith(".hotel") ? "DemoHotelMobile.apk"
                : pkg.EndsWith(".voice") ? "VoiceAppointmentMobile.apk"
                : "DemoShopMobile.apk";
        var sb = new StringBuilder();
        sb.AppendLine("import { remote } from 'webdriverio';");
        sb.AppendLine("import { expect } from '@wdio/globals';");
        sb.AppendLine();
        sb.AppendLine($"// Bug Hunter Mobile finding {f.Id} ({f.Provenance}, {f.Severity}): {f.Title}");
        sb.AppendLine($"// Target APK: android/apks/{apk} ({pkg}) · Driver: Appium UiAutomator2");
        sb.AppendLine($"// Expected:   {OneLine(f.Expected)}");
        sb.AppendLine($"// Actual:     {OneLine(f.Actual)}");
        if (h.SecretNames.Count > 0) sb.AppendLine($"// Secrets are read from the environment: {string.Join(", ", h.SecretNames.Select(Env))}");
        sb.AppendLine($"describe({Q(f.Title)}, () => {{");
        sb.AppendLine("  it('reproduces the mobile defect on Android Emulator (Pixel_8)', async () => {");
        sb.AppendLine("    const driver = await remote({");
        sb.AppendLine("      hostname: '127.0.0.1', port: 4723,");
        sb.AppendLine("      capabilities: {");
        sb.AppendLine("        platformName: 'Android',");
        sb.AppendLine("        'appium:automationName': 'UiAutomator2',");
        sb.AppendLine("        'appium:deviceName': 'Pixel_8',");
        sb.AppendLine($"        'appium:appPackage': {Q(pkg)},");
        sb.AppendLine("        'appium:appActivity': 'com.bughunter.mobile.MainActivity',");
        sb.AppendLine("        'appium:noReset': false");
        sb.AppendLine("      }");
        sb.AppendLine("    });");
        sb.AppendLine("    try {");
        foreach (var s in steps)
            sb.AppendLine("      " + AppiumLine(s, pkg));
        sb.AppendLine();
        if (f.Oracle == "android-crash")
            sb.AppendLine("      const logs = await driver.getLogs('logcat');\n      expect(logs.some((l: any) => String(l.message).includes('FATAL EXCEPTION'))).toBe(false);");
        else if (f.Oracle == "android-anr")
            sb.AppendLine("      const logs = await driver.getLogs('logcat');\n      expect(logs.some((l: any) => String(l.message).includes('ANR in '))).toBe(false);");
        else if (f.Oracle == "search-miss" && f.AssertText is { } want)
            sb.AppendLine($"      await expect(driver.$({Q($"android=new UiSelector().textContains(\"{EscapeUiSelector(want)}\")")})).toBeDisplayed();");
        else if (f.Oracle is "broken-render" or "negative-amount" && f.AssertText is { } bad)
            sb.AppendLine($"      await expect(driver.$({Q($"android=new UiSelector().textContains(\"{EscapeUiSelector(bad)}\")")})).not.toBeDisplayed();");
        else
            sb.AppendLine($"      // Assert expected mobile behaviour: {OneLine(f.Expected)}");
        sb.AppendLine("    } finally {");
        sb.AppendLine("      await driver.deleteSession();");
        sb.AppendLine("    }");
        sb.AppendLine("  });");
        sb.AppendLine("});");
        return sb.ToString();
    }

    // A journey as a regression test: walk it, and expect its outcome call to succeed.
    public static string WriteJourney(Hunt h, Journeys.Journey j)
    {
        var (method, path) = (j.Outcome.Split(' ')[0], j.Outcome.Split(' ', 2)[1]);
        var pattern = "^" + Regex.Escape(path).Replace(@"\{id}", "[^/]+") + "$";
        var sb = new StringBuilder();
        sb.AppendLine("import { test, expect } from '@playwright/test';");
        sb.AppendLine();
        sb.AppendLine($"// Bug Hunter journey ({j.Role}): {j.Name}. Outcome: {j.Outcome} succeeds.");
        if (h.SecretNames.Count > 0) sb.AppendLine($"// Secrets are read from the environment: {string.Join(", ", h.SecretNames.Select(Env))}");
        sb.AppendLine($"test({Q(j.Name)}, async ({{ page }}) => {{");
        for (var i = 0; i < j.Steps.Count; i++)
        {
            if (i == j.Steps.Count - 1)
                sb.AppendLine($"  const outcome = page.waitForResponse((r) => r.request().method() === {Q(method)} && new RegExp({Q(pattern)}).test(new URL(r.url()).pathname));");
            sb.AppendLine("  " + Line(j.Steps[i], h));
        }
        sb.AppendLine();
        sb.AppendLine("  expect((await outcome).ok(), 'the journey reaches its outcome').toBe(true);");
        sb.AppendLine("});");
        return sb.ToString();
    }

    public static string Write(Hunt h, Finding f)
    {
        if (h.Steps.FirstOrDefault(s => s.N == f.Step) is { Driver: "Probe" } hit) return WriteProbe(h, f, hit);
        var steps = Trail(h, f);
        var mutating = f.RequestMethod is "POST" or "PUT" or "PATCH" or "DELETE";
        var waitResponse = f.RequestPath is not null && (mutating || f.Oracle is "server-error" or "invariant");
        var sb = new StringBuilder();
        sb.AppendLine("import { test, expect } from '@playwright/test';");
        sb.AppendLine();
        sb.AppendLine($"// Bug Hunter finding {f.Id} ({f.Provenance}, {f.Severity}): {f.Title}");
        sb.AppendLine($"// Expected: {OneLine(f.Expected)}");
        sb.AppendLine($"// Actual:   {OneLine(f.Actual)}");
        if (h.SecretNames.Count > 0) sb.AppendLine($"// Secrets are read from the environment: {string.Join(", ", h.SecretNames.Select(Env))}");
        sb.AppendLine($"test({Q(f.Title)}, async ({{ page }}) => {{");
        if (f.Oracle == "js-error") sb.AppendLine("  const pageErrors: string[] = [];\n  page.on('pageerror', (e) => pageErrors.push(e.message));");
        for (var i = 0; i < steps.Count; i++)
        {
            var s = steps[i];
            if (i == steps.Count - 1 && waitResponse)
                sb.AppendLine($"  const response = page.waitForResponse((r) => r.request().method() === {Q(f.RequestMethod!)} && new URL(r.url()).pathname === {Q(f.RequestPath!)});");
            sb.AppendLine("  " + Line(s, h));
        }
        sb.AppendLine();
        if (waitResponse && RejectOracles.Contains(f.Oracle) && mutating)
            sb.AppendLine("  expect((await response).status(), 'the server should reject this request').toBeGreaterThanOrEqual(400);");
        else if (waitResponse && f.Oracle == "server-error")
            sb.AppendLine("  expect((await response).status()).toBeLessThan(500);");
        else if (f.Oracle == "search-miss" && f.AssertText is { } want)
            sb.AppendLine($"  await expect(page.getByText({Q(want)}).first()).toBeVisible();");
        else if (f.Oracle is "broken-render" or "negative-amount" && f.AssertText is { } bad)
            sb.AppendLine($"  await expect(page.getByText({Q(bad)})).toHaveCount(0);");
        else if (f.Oracle == "js-error")
            sb.AppendLine("  expect(pageErrors).toEqual([]);");
        else if (waitResponse && f.Oracle == "invariant" && f.Rule is { } rule && InvariantRules.ToJs(rule) is { } js)
        {
            sb.AppendLine("  const res = await response;");
            sb.AppendLine("  const body = await res.json().catch(() => null);");
            sb.AppendLine("  let req = null; try { req = res.request().postDataJSON(); } catch { /* not JSON */ }");
            sb.AppendLine("  const q = Object.fromEntries(new URL(res.url()).searchParams);");
            sb.AppendLine("  const eq = (a, b) => typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-9 : a === b;");
            sb.AppendLine($"  // Rule: {OneLine(rule)}");
            sb.AppendLine($"  expect({js}, {Q(f.Requirement is null ? f.Title : $"{f.Requirement}: {f.Title}")}).toBe(true);");
        }
        else
            sb.AppendLine($"  // TODO: assert the expected behaviour: {OneLine(f.Expected)}");
        sb.AppendLine("});");
        return sb.ToString();
    }

    // A probe finding: replay the UI steps that made the app send the original call, then resend it changed with the
    // app's own headers (taken from the recorded request, so whatever session scheme the app uses keeps working).
    static string WriteProbe(Hunt h, Finding f, HuntStep hit)
    {
        var group = hit.Action.Args?.GetValueOrDefault("group");
        var trail = Trail(h, f);
        var probes = trail.Where(s => s.Driver == "Probe" && (f.MinimalSteps is not null || s.Action.Args?.GetValueOrDefault("group") == group)).ToList();
        if (probes.Count == 0) probes = [hit];
        var lastBase = probes.Max(s => int.TryParse(s.Action.Args?.GetValueOrDefault("base"), out var b) ? b : 0);
        var ui = trail.Where(s => s.Driver != "Probe" && (f.MinimalSteps is not null || s.N <= lastBase)).ToList();
        var anon = probes.Any(s => s.Action.Args?.GetValueOrDefault("dropAuth") == "true");
        var sb = new StringBuilder();
        sb.AppendLine($"import {{ test, expect{(anon ? ", request" : "")} }} from '@playwright/test';");
        sb.AppendLine();
        sb.AppendLine($"// Bug Hunter finding {f.Id} ({f.Provenance}, {f.Severity}): {f.Title}");
        sb.AppendLine($"// Expected: {OneLine(f.Expected)}");
        sb.AppendLine($"// Actual:   {OneLine(f.Actual)}");
        sb.AppendLine("// Found by the engine's API probe phase: the UI steps make the app send the call, then the test resends it changed.");
        if (h.SecretNames.Count > 0) sb.AppendLine($"// Secrets are read from the environment: {string.Join(", ", h.SecretNames.Select(Env))}");
        sb.AppendLine($"test({Q(f.Title)}, async ({{ page }}) => {{");
        sb.AppendLine("  const seen = new Map();");
        sb.AppendLine("  page.on('request', (r) => seen.set(`${r.method()} ${new URL(r.url()).pathname}`, r));");
        foreach (var s in ui) sb.AppendLine("  " + Line(s, h));
        sb.AppendLine();
        sb.AppendLine("  const send = async (key: string, url: string | null, data: string | null, anonymous = false) => {");
        sb.AppendLine("    const base = seen.get(key);");
        sb.AppendLine("    expect(base, `the app sent ${key}`).toBeTruthy();");
        sb.AppendLine("    const skip = ['host', 'content-length', 'cookie', 'connection', 'accept-encoding'];");
        sb.AppendLine("    const headers = Object.fromEntries(Object.entries(await base.allHeaders()).filter(([k]) => !k.startsWith(':') && !skip.includes(k)" +
                      " && !(anonymous && /authorization|session|token|csrf|xsrf|api-?key/i.test(k))));");
        sb.AppendLine($"    const client = anonymous ? {(anon ? "await request.newContext()" : "page.request")} : page.request;");
        sb.AppendLine("    return client.fetch(url ?? base.url(), { method: base.method(), headers, data: data ?? base.postData() ?? undefined, failOnStatusCode: false });");
        sb.AppendLine("  };");
        sb.AppendLine("  const counts: number[] = [];");
        sb.AppendLine("  let res;");
        foreach (var s in probes)
        {
            var a = s.Action;
            var key = $"{a.Key} {a.Args?.GetValueOrDefault("path")}";
            var url = a.Url is { } u && Uri.TryCreate(u, UriKind.Absolute, out var uri) && uri.Query.Length > 1 ? Q(u) : "null";
            sb.AppendLine($"  // {a.Args?.GetValueOrDefault("label")}");
            sb.AppendLine($"  res = await send({Q(key)}, {url}, {(a.Value is null ? "null" : JsStr(a.Value))}{(a.Args?.GetValueOrDefault("dropAuth") == "true" ? ", true" : "")});");
            if (a.Routine == "case") sb.AppendLine("  counts.push(((await res.json().catch(() => null)) as any)?.items?.length ?? -1);");
        }
        sb.AppendLine();
        if (f.Oracle == "case-variants")
            sb.AppendLine("  expect(new Set(counts).size, 'the same results in any letter case').toBe(1);");
        else if (RejectOracles.Contains(f.Oracle) || f.Oracle == "model-judgement")
            sb.AppendLine("  expect(res.status(), 'the server should reject this request').toBeGreaterThanOrEqual(400);");
        else if (f.Oracle == "invariant" && f.Rule is { } rule && InvariantRules.ToJs(rule) is { } js)
        {
            sb.AppendLine("  const body = await res.json().catch(() => null);");
            sb.AppendLine("  const req = null; const q = Object.fromEntries(new URL(res.url()).searchParams);");
            sb.AppendLine("  const eq = (a, b) => typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-9 : a === b;");
            sb.AppendLine($"  // Rule: {OneLine(rule)}");
            sb.AppendLine($"  expect({js}, {Q(f.Requirement is null ? f.Title : $"{f.Requirement}: {f.Title}")}).toBe(true);");
        }
        else if (f.Oracle == "search-miss" && f.AssertText is { } want)
            sb.AppendLine($"  expect(JSON.stringify(await res.json())).toContain({Q(want)});");
        else
            sb.AppendLine($"  // TODO: assert the expected behaviour on the response: {OneLine(f.Expected)}");
        sb.AppendLine("});");
        return sb.ToString();
    }

    static string JsStr(string v) =>
        !v.Contains("{{secret:") ? Q(v)
            : "`" + Regex.Replace(v.Replace("\\", "\\\\").Replace("`", "\\`").Replace("${", "\\${"), @"\{\{secret:([\w.-]+)\}\}", m => $"${{process.env.{Env(m.Groups[1].Value)} ?? ''}}") + "`";

    static string AppiumLine(HuntStep s, string pkg)
    {
        var a = s.Action; var t = s.Target;
        if (s.N == 0) return $"await driver.activateApp({Q(pkg)});";
        if (s.Driver == "Probe") return $"// API Probe ({a.Args?.GetValueOrDefault("label") ?? a.Routine}): {a.Key} {a.Args?.GetValueOrDefault("path")}";
        var loc = t is null ? null : AppiumLocator(t);
        return a.Type switch
        {
            "click" when loc is not null => $"await {loc}.click();",
            "fill" when loc is not null => $"await {loc}.setValue({Value(a.Value)});",
            "select" when loc is not null => $"await {loc}.click();",
            "check" when loc is not null => $"await {loc}.click();",
            "press" => $"await driver.pressKeyCode({(a.Key == "Back" ? 4 : 66)});",
            "navigate" => $"await driver.execute('mobile: deepLink', {{ url: {Q(a.Url ?? "")}, package: {Q(pkg)} }});",
            "back" => "await driver.back();",
            "reload" => $"await driver.terminateApp({Q(pkg)}); await driver.activateApp({Q(pkg)});",
            "scroll" => "await driver.execute('mobile: scrollGesture', { left: 50, top: 300, width: 300, height: 500, direction: 'down', percent: 0.75 });",
            "wait" => $"await driver.pause({(int.TryParse(a.Value, out var ms) ? Math.Min(ms, 5000) : 1000)});",
            _ => $"// step {s.N}: {a.Type}"
        };
    }

    public static string AppiumLocator(ElementInfo t)
    {
        if (t.Testid is { Length: > 0 } id) return $"driver.$({Q($"id={id}")})";
        if (t.Label is { Length: > 0 } label) return $"driver.$({Q($"~{label}")})";
        if (t.Name.Length > 0) return $"driver.$({Q($"android=new UiSelector().textContains(\"{EscapeUiSelector(t.Name)}\")")})";
        if (t.Placeholder is { Length: > 0 } ph) return $"driver.$({Q($"android=new UiSelector().textContains(\"{EscapeUiSelector(ph)}\")")})";
        return $"driver.$({Q("android=new UiSelector().clickable(true)")})";
    }

    static string Line(HuntStep s, Hunt h)
    {
        var a = s.Action; var t = s.Target;
        if (s.N == 0) return $"await page.goto({Q(a.Url ?? h.Url)});";
        var loc = t is null ? null : Locator(t);
        return a.Type switch
        {
            "click" when loc is not null => $"await {loc}.click();",
            "fill" when loc is not null => $"await {loc}.fill({Value(a.Value)});",
            "select" when loc is not null => $"await {loc}.selectOption({{ label: {Q(a.Value ?? "")} }});",
            "check" when loc is not null => $"await {loc}.setChecked({(a.Value == "false" ? "false" : "true")});",
            "press" => loc is null ? $"await page.keyboard.press({Q(a.Key ?? "Enter")});" : $"await {loc}.press({Q(a.Key ?? "Enter")});",
            "navigate" => $"await page.goto(new URL({Q(a.Url ?? "")}, page.url()).href);",
            "back" => "await page.goBack();",
            "reload" => "await page.reload();",
            "scroll" => "await page.mouse.wheel(0, 700);",
            "wait" => $"await page.waitForTimeout({(int.TryParse(a.Value, out var ms) ? Math.Min(ms, 5000) : 1000)});",
            _ => $"// step {s.N}: {a.Type} (no stable locator recorded)"
        };
    }

    public static string Locator(ElementInfo t)
    {
        string l;
        if (t.Testid is { Length: > 0 } id) l = $"page.getByTestId({Q(id)})";
        else if (FieldRoles.Contains(t.Role) && t.Label is { Length: > 0 } label) l = $"page.getByLabel({Q(label)}, {{ exact: true }})";
        else if (PlaywrightRoles.Contains(t.Role) && t.Name.Length > 0) l = $"page.getByRole('{t.Role}', {{ name: {Q(t.Name)}, exact: true }})";
        else if (t.Placeholder is { Length: > 0 } ph) l = $"page.getByPlaceholder({Q(ph)})";
        else l = $"page.locator('{t.Tag}')";
        return t.Dupes > 1 ? $"{l}.nth({t.Nth})" : l;
    }

    static string Value(string? v)
    {
        var m = Regex.Match(v ?? "", @"^\{\{secret:([\w.-]+)\}\}$");
        return m.Success ? $"process.env.{Env(m.Groups[1].Value)} ?? ''" : Q(v ?? "");
    }

    static string EscapeUiSelector(string s) => s.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\n", " ");
    static string Env(string secret) => "HUNT_" + Regex.Replace(secret.ToUpperInvariant(), "[^A-Z0-9]", "_");
    static string OneLine(string s) => Regex.Replace(s, @"\s+", " ");
    static string Q(string s) => "'" + s.Replace("\\", "\\\\").Replace("'", "\\'").Replace("\n", "\\n") + "'";
}

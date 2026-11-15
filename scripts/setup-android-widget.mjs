#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_ROOT_DIR = path.resolve(__dirname, '..');

const KOTLIN_VERSION = '2.1.10';

const WIDGET_RECEIVER_XML = `        <receiver
            android:name="com.aurastudy.app.widget.AuraStudyWidgetProvider"
            android:exported="true">
            <intent-filter>
                <action android:name="android.appwidget.action.APPWIDGET_UPDATE" />
            </intent-filter>
            <meta-data
                android:name="android.appwidget.provider"
                android:resource="@xml/widget_aurastudy_info" />
        </receiver>`;

const POST_NOTIFICATIONS_PERMISSION = 'android.permission.POST_NOTIFICATIONS';
const POST_NOTIFICATIONS_XML =
  '    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />';

function ensureFileExists(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`找不到 ${label}：${filePath}（請先執行 npx cap add android）`);
  }
}

function copyWidgetResources(widgetMainDir, androidMainDir) {
  ensureFileExists(widgetMainDir, 'android-widget 原生範本目錄');
  ensureFileExists(androidMainDir, 'android/app/src/main 目錄');
  fs.cpSync(widgetMainDir, androidMainDir, { recursive: true, force: true });
  return `已同步原生 Widget 程式碼與資源至 ${androidMainDir}`;
}

function patchAndroidManifest(manifestPath) {
  ensureFileExists(manifestPath, 'AndroidManifest.xml');
  const original = fs.readFileSync(manifestPath, 'utf8');

  if (!original.includes('</application>')) {
    throw new Error('AndroidManifest.xml 缺少 </application> 結尾標籤');
  }

  let updated = original;
  const changes = [];

  if (!updated.includes(POST_NOTIFICATIONS_PERMISSION)) {
    if (/<application\b/.test(updated)) {
      updated = updated.replace(
        /([ \t]*<application\b)/,
        `${POST_NOTIFICATIONS_XML}\n$1`,
      );
      changes.push('POST_NOTIFICATIONS 權限');
    } else if (updated.includes('</manifest>')) {
      updated = updated.replace(
        '</manifest>',
        `${POST_NOTIFICATIONS_XML}\n</manifest>`,
      );
      changes.push('POST_NOTIFICATIONS 權限');
    }
  }

  if (!updated.includes('com.aurastudy.app.widget.AuraStudyWidgetProvider')) {
    updated = updated.replace(
      '</application>',
      `${WIDGET_RECEIVER_XML}\n    </application>`,
    );
    changes.push('AuraStudyWidgetProvider receiver');
  }

  if (changes.length === 0) {
    return 'AndroidManifest.xml 已包含 POST_NOTIFICATIONS 權限與 AuraStudyWidgetProvider，略過重複寫入';
  }

  fs.writeFileSync(manifestPath, updated, 'utf8');
  return `已於 AndroidManifest.xml 寫入 ${changes.join('與 ')}`;
}

function findMainActivityPath(androidMainDir) {
  const preferredKt = path.join(
    androidMainDir,
    'java',
    'com',
    'aurastudy',
    'app',
    'MainActivity.kt',
  );
  if (fs.existsSync(preferredKt)) return preferredKt;

  const preferredJava = path.join(
    androidMainDir,
    'java',
    'com',
    'aurastudy',
    'app',
    'MainActivity.java',
  );
  if (fs.existsSync(preferredJava)) return preferredJava;

  const javaRoot = path.join(androidMainDir, 'java');
  if (!fs.existsSync(javaRoot)) {
    throw new Error(`找不到 java 原始碼目錄：${javaRoot}`);
  }

  const stack = [javaRoot];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.name === 'MainActivity.kt' || entry.name === 'MainActivity.java') {
        return fullPath;
      }
    }
  }

  throw new Error('找不到 MainActivity.kt 或 MainActivity.java');
}

function patchMainActivityKotlin(content) {
  if (
    content.includes('AuraStudyAndroidBridge') ||
    content.includes('AuraStudyWidgetBridge')
  ) {
    return { updated: content, changed: false };
  }

  let next = content;

  if (!next.includes('import android.os.Bundle')) {
    next = next.replace(
      /^(package\s+[^\r\n]+\r?\n)/m,
      '$1\nimport android.os.Bundle\n',
    );
  }
  if (!next.includes('import com.aurastudy.app.widget.AuraStudyWidgetBridge')) {
    next = next.replace(
      /^(import\s+[^\r\n]+\r?\n)/m,
      'import com.aurastudy.app.widget.AuraStudyWidgetBridge\n$1',
    );
  }

  const bridgeLine =
    '        bridge?.webView?.addJavascriptInterface(AuraStudyWidgetBridge(this), "AuraStudyAndroidBridge")';

  if (/override\s+fun\s+onCreate\s*\(/.test(next)) {
    next = next.replace(
      /(super\.onCreate\([^\r\n)]*\))/,
      `$1\n${bridgeLine}`,
    );
  } else if (/class\s+MainActivity\s*:\s*BridgeActivity\(\)\s*\{\s*\}/.test(next)) {
    next = next.replace(
      /class\s+MainActivity\s*:\s*BridgeActivity\(\)\s*\{\s*\}/,
      `class MainActivity : BridgeActivity() {\n    override fun onCreate(savedInstanceState: Bundle?) {\n        super.onCreate(savedInstanceState)\n${bridgeLine}\n    }\n}`,
    );
  } else if (/class\s+MainActivity\s*:\s*BridgeActivity\(\)\s*\{/.test(next)) {
    next = next.replace(
      /(class\s+MainActivity\s*:\s*BridgeActivity\(\)\s*\{)/,
      `$1\n    override fun onCreate(savedInstanceState: Bundle?) {\n        super.onCreate(savedInstanceState)\n${bridgeLine}\n    }`,
    );
  } else if (/class\s+MainActivity\s*:\s*BridgeActivity\(\)/.test(next)) {
    next = next.replace(
      /class\s+MainActivity\s*:\s*BridgeActivity\(\)/,
      `class MainActivity : BridgeActivity() {\n    override fun onCreate(savedInstanceState: Bundle?) {\n        super.onCreate(savedInstanceState)\n${bridgeLine}\n    }\n}`,
    );
  } else {
    throw new Error('無法自動辨識 MainActivity.kt 的類別結構');
  }

  return { updated: next, changed: true };
}

function patchMainActivityJava(content) {
  if (
    content.includes('AuraStudyAndroidBridge') ||
    content.includes('AuraStudyWidgetBridge')
  ) {
    return { updated: content, changed: false };
  }

  let next = content;

  if (!next.includes('import android.os.Bundle;')) {
    next = next.replace(
      /^(package\s+[^;\r\n]+;\r?\n)/m,
      '$1\nimport android.os.Bundle;\n',
    );
  }
  if (!next.includes('import com.aurastudy.app.widget.AuraStudyWidgetBridge;')) {
    next = next.replace(
      /^(import\s+[^;\r\n]+;\r?\n)/m,
      'import com.aurastudy.app.widget.AuraStudyWidgetBridge;\n$1',
    );
  }

  const bridgeBlock = [
    '        if (this.bridge != null && this.bridge.getWebView() != null) {',
    '            this.bridge.getWebView().addJavascriptInterface(',
    '                new AuraStudyWidgetBridge(this),',
    '                "AuraStudyAndroidBridge"',
    '            );',
    '        }',
  ].join('\n');

  if (/void\s+onCreate\s*\(\s*Bundle\s+/.test(next)) {
    next = next.replace(
      /(super\.onCreate\([^\r\n)]*\)\s*;)/,
      `$1\n${bridgeBlock}`,
    );
  } else if (/public\s+class\s+MainActivity\s+extends\s+BridgeActivity\s*\{\s*\}/.test(next)) {
    next = next.replace(
      /public\s+class\s+MainActivity\s+extends\s+BridgeActivity\s*\{\s*\}/,
      `public class MainActivity extends BridgeActivity {\n    @Override\n    public void onCreate(Bundle savedInstanceState) {\n        super.onCreate(savedInstanceState);\n${bridgeBlock}\n    }\n}`,
    );
  } else if (/public\s+class\s+MainActivity\s+extends\s+BridgeActivity\s*\{/.test(next)) {
    next = next.replace(
      /(public\s+class\s+MainActivity\s+extends\s+BridgeActivity\s*\{)/,
      `$1\n    @Override\n    public void onCreate(Bundle savedInstanceState) {\n        super.onCreate(savedInstanceState);\n${bridgeBlock}\n    }`,
    );
  } else {
    throw new Error('無法自動辨識 MainActivity.java 的類別結構');
  }

  return { updated: next, changed: true };
}

function patchMainActivity(androidMainDir) {
  const mainActivityPath = findMainActivityPath(androidMainDir);
  const original = fs.readFileSync(mainActivityPath, 'utf8');
  const isKotlin = mainActivityPath.endsWith('.kt');

  const { updated, changed } = isKotlin
    ? patchMainActivityKotlin(original)
    : patchMainActivityJava(original);

  if (!changed) {
    return `${path.basename(mainActivityPath)} 已註冊 AuraStudyAndroidBridge，略過重複寫入`;
  }

  fs.writeFileSync(mainActivityPath, updated, 'utf8');
  return `已於 ${path.basename(mainActivityPath)} 註冊 AuraStudyAndroidBridge`;
}

function patchRootBuildGradle(rootBuildGradlePath) {
  if (!fs.existsSync(rootBuildGradlePath)) {
    return '未找到 android/build.gradle，略過根層 Kotlin classpath 設定';
  }

  const original = fs.readFileSync(rootBuildGradlePath, 'utf8');
  if (
    original.includes('kotlin-gradle-plugin') ||
    original.includes('org.jetbrains.kotlin.android')
  ) {
    return 'android/build.gradle 已包含 Kotlin 外掛依賴，略過';
  }

  let updated = original;
  if (/classpath\s+['"]com\.android\.tools\.build:gradle:[^'"]+['"]/.test(updated)) {
    updated = updated.replace(
      /(classpath\s+['"]com\.android\.tools\.build:gradle:[^'"]+['"])/,
      `$1\n        classpath "org.jetbrains.kotlin:kotlin-gradle-plugin:${KOTLIN_VERSION}"`,
    );
  } else if (/buildscript\s*\{[\s\S]*?dependencies\s*\{/.test(updated)) {
    updated = updated.replace(
      /(buildscript\s*\{[\s\S]*?dependencies\s*\{)/,
      `$1\n        classpath "org.jetbrains.kotlin:kotlin-gradle-plugin:${KOTLIN_VERSION}"`,
    );
  } else if (/plugins\s*\{/.test(updated)) {
    updated = updated.replace(
      /(plugins\s*\{)/,
      `$1\n    id 'org.jetbrains.kotlin.android' version '${KOTLIN_VERSION}' apply false`,
    );
  } else {
    throw new Error('無法在 android/build.gradle 找到 dependencies 或 plugins 區塊');
  }

  fs.writeFileSync(rootBuildGradlePath, updated, 'utf8');
  return `已於 android/build.gradle 加入 kotlin-gradle-plugin:${KOTLIN_VERSION}`;
}

function patchAppBuildGradle(appBuildGradlePath) {
  ensureFileExists(appBuildGradlePath, 'android/app/build.gradle');
  const original = fs.readFileSync(appBuildGradlePath, 'utf8');

  let updated = original;
  const hasKotlinPlugin =
    updated.includes('org.jetbrains.kotlin.android') ||
    updated.includes("'kotlin-android'") ||
    updated.includes('"kotlin-android"');

  if (!hasKotlinPlugin) {
    if (/apply\s+plugin:\s*['"]com\.android\.application['"]/.test(updated)) {
      updated = updated.replace(
        /(apply\s+plugin:\s*['"]com\.android\.application['"])/,
        `$1\napply plugin: 'org.jetbrains.kotlin.android'`,
      );
    } else if (/plugins\s*\{/.test(updated)) {
      updated = updated.replace(
        /(plugins\s*\{)/,
        `$1\n    id 'org.jetbrains.kotlin.android'`,
      );
    } else {
      updated = `apply plugin: 'org.jetbrains.kotlin.android'\n${updated}`;
    }
  }

  if (!updated.includes('kotlinOptions')) {
    const jvmBlock = [
      '    compileOptions {',
      '        sourceCompatibility JavaVersion.VERSION_21',
      '        targetCompatibility JavaVersion.VERSION_21',
      '    }',
      '    kotlinOptions {',
      "        jvmTarget = '21'",
      '    }',
    ].join('\n');

    if (/android\s*\{/.test(updated)) {
      updated = updated.replace(/(android\s*\{)/, `$1\n${jvmBlock}`);
    }
  }

  if (updated === original) {
    return 'android/app/build.gradle 已啟用 Kotlin 支援，略過';
  }

  fs.writeFileSync(appBuildGradlePath, updated, 'utf8');
  return '已於 android/app/build.gradle 啟用 org.jetbrains.kotlin.android 與 JVM 21 設定';
}

/**
 * @param {{ rootDir?: string; androidDir?: string; widgetMainDir?: string }} [options]
 * @returns {string[]}
 */
export function setupAndroidWidget(options = {}) {
  const rootDir = options.rootDir ?? DEFAULT_ROOT_DIR;
  const androidDir = options.androidDir ?? path.join(rootDir, 'android');
  const widgetMainDir =
    options.widgetMainDir ?? path.join(rootDir, 'android-widget', 'app', 'src', 'main');
  const androidMainDir = path.join(androidDir, 'app', 'src', 'main');

  const logs = [];
  logs.push(copyWidgetResources(widgetMainDir, androidMainDir));
  logs.push(patchAndroidManifest(path.join(androidMainDir, 'AndroidManifest.xml')));
  logs.push(patchMainActivity(androidMainDir));
  logs.push(patchRootBuildGradle(path.join(androidDir, 'build.gradle')));
  logs.push(patchAppBuildGradle(path.join(androidDir, 'app', 'build.gradle')));
  return logs;
}

const isDirectExecution =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(__filename);

if (isDirectExecution) {
  try {
    const logs = setupAndroidWidget();
    for (const line of logs) {
      console.log(`[setup-android-widget] ${line}`);
    }
  } catch (error) {
    console.error(
      `[setup-android-widget] 失敗：${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}

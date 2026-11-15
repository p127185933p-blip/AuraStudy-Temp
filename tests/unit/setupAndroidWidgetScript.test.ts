import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { setupAndroidWidget } from '../../scripts/setup-android-widget.mjs';

const tempDirs: string[] = [];

function createMockAndroidProject(variant: 'java' | 'kotlin'): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aurastudy-cap-'));
  tempDirs.push(tmpDir);

  const androidDir = path.join(tmpDir, 'android');
  const appDir = path.join(androidDir, 'app');
  const mainDir = path.join(appDir, 'src', 'main');
  const pkgDir = path.join(mainDir, 'java', 'com', 'aurastudy', 'app');

  fs.mkdirSync(pkgDir, { recursive: true });
  fs.mkdirSync(path.join(mainDir, 'res'), { recursive: true });

  fs.writeFileSync(
    path.join(androidDir, 'build.gradle'),
    `buildscript {
    dependencies {
        classpath 'com.android.tools.build:gradle:8.13.0'
    }
}`,
    'utf8',
  );

  fs.writeFileSync(
    path.join(appDir, 'build.gradle'),
    `apply plugin: 'com.android.application'

android {
    namespace = "com.aurastudy.app"
    compileSdk = 36
}`,
    'utf8',
  );

  fs.writeFileSync(
    path.join(mainDir, 'AndroidManifest.xml'),
    `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <application android:label="@string/app_name">
        <activity android:name=".MainActivity" android:exported="true" />
    </application>
</manifest>`,
    'utf8',
  );

  if (variant === 'java') {
    fs.writeFileSync(
      path.join(pkgDir, 'MainActivity.java'),
      `package com.aurastudy.app;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {}
`,
      'utf8',
    );
  } else {
    fs.writeFileSync(
      path.join(pkgDir, 'MainActivity.kt'),
      `package com.aurastudy.app

import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity()
`,
      'utf8',
    );
  }

  return androidDir;
}

describe('scripts/setup-android-widget.mjs', () => {
  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('copies widget files, patches Java MainActivity, AndroidManifest, and Gradle idempotently', () => {
    const androidDir = createMockAndroidProject('java');
    const rootDir = path.resolve(process.cwd());

    setupAndroidWidget({ rootDir, androidDir });
    // Second run verifies idempotency
    setupAndroidWidget({ rootDir, androidDir });

    const mainDir = path.join(androidDir, 'app', 'src', 'main');
    expect(
      fs.existsSync(
        path.join(mainDir, 'java', 'com', 'aurastudy', 'app', 'widget', 'AuraStudyWidgetBridge.kt'),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(mainDir, 'java', 'com', 'aurastudy', 'app', 'widget', 'AuraStudyWidgetProvider.kt'),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(mainDir, 'res', 'xml', 'widget_aurastudy_info.xml')),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(mainDir, 'res', 'layout', 'widget_aurastudy.xml')),
    ).toBe(true);

    const manifest = fs.readFileSync(path.join(mainDir, 'AndroidManifest.xml'), 'utf8');
    expect(manifest.match(/AuraStudyWidgetProvider/g)).toHaveLength(1);
    expect(manifest.match(/android\.permission\.POST_NOTIFICATIONS/g)).toHaveLength(1);
    expect(manifest).toContain(
      '<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />',
    );
    expect(manifest).toContain('android.appwidget.action.APPWIDGET_UPDATE');
    expect(manifest).toContain('@xml/widget_aurastudy_info');

    const mainJava = fs.readFileSync(
      path.join(mainDir, 'java', 'com', 'aurastudy', 'app', 'MainActivity.java'),
      'utf8',
    );
    expect(mainJava.match(/AuraStudyAndroidBridge/g)).toHaveLength(1);
    expect(mainJava).toContain('new AuraStudyWidgetBridge(this)');

    const rootGradle = fs.readFileSync(path.join(androidDir, 'build.gradle'), 'utf8');
    expect(rootGradle.match(/kotlin-gradle-plugin/g)).toHaveLength(1);

    const appGradle = fs.readFileSync(path.join(androidDir, 'app', 'build.gradle'), 'utf8');
    expect(appGradle.match(/org\.jetbrains\.kotlin\.android/g)).toHaveLength(1);
    expect(appGradle).toContain("jvmTarget = '21'");
  });

  it('supports Kotlin MainActivity.kt and registers bridge.webView.addJavascriptInterface idempotently', () => {
    const androidDir = createMockAndroidProject('kotlin');
    const rootDir = path.resolve(process.cwd());

    setupAndroidWidget({ rootDir, androidDir });
    setupAndroidWidget({ rootDir, androidDir });

    const mainKt = fs.readFileSync(
      path.join(androidDir, 'app', 'src', 'main', 'java', 'com', 'aurastudy', 'app', 'MainActivity.kt'),
      'utf8',
    );
    expect(mainKt.match(/AuraStudyAndroidBridge/g)).toHaveLength(1);
    expect(mainKt).toContain(
      'bridge?.webView?.addJavascriptInterface(AuraStudyWidgetBridge(this), "AuraStudyAndroidBridge")',
    );
  });
});

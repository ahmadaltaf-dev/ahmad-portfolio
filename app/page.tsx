'use client';

import { useEffect, useRef, useState } from 'react';
import Script from 'next/script';

export default function Home() {
  const [threeLoaded, setThreeLoaded] = useState(false);
  const initialized = useRef(false);

  useEffect(() => {
    if (!threeLoaded || initialized.current) return;
    initialized.current = true;

    // @ts-ignore - THREE is loaded globally via the CDN script
    const THREE = (window as any).THREE;
    if (!THREE) return;

    const canvas = document.getElementById('scene-canvas') as HTMLCanvasElement;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.z = 6.2;

    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const ambient = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambient);
    const key = new THREE.DirectionalLight(0xff6b35, 1.1);
    key.position.set(4, 4, 6);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x3e7cb1, 0.9);
    rim.position.set(-4, -2, -4);
    scene.add(rim);

    const baseGeo = new THREE.IcosahedronGeometry(1.5, 4);
    const posAttr = baseGeo.attributes.position;
    const vertCount = posAttr.count;
    const baseVerts: any[] = [];
    for (let i = 0; i < vertCount; i++) {
      baseVerts.push(new THREE.Vector3(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)));
    }

    const icoDirections = (function () {
      const t = (1 + Math.sqrt(5)) / 2;
      const pts = [
        [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
        [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
        [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
      ];
      return pts.map((p) => new THREE.Vector3(p[0], p[1], p[2]).normalize());
    })();

    function buildTarget(kind: string) {
      return baseVerts.map((v) => {
        const n = v.clone().normalize();
        if (kind === 'device') {
          const maxComp = Math.max(Math.abs(n.x), Math.abs(n.y), Math.abs(n.z));
          return n.clone().multiplyScalar(1 / maxComp).multiplyScalar(1.4);
        }
        if (kind === 'signal') {
          let best = -Infinity;
          for (const d of icoDirections) {
            const dot = n.dot(d);
            if (dot > best) best = dot;
          }
          const bulge = Math.pow(Math.max(best, 0), 5);
          const radius = 1.1 + bulge * 1.0;
          return n.clone().multiplyScalar(radius);
        }
        if (kind === 'sync') {
          const u = Math.atan2(n.z, n.x);
          const v = Math.asin(Math.max(-1, Math.min(1, n.y)));
          const R = 1.25, r = 0.55;
          return new THREE.Vector3(
            (R + r * Math.cos(v * 2)) * Math.cos(u),
            r * Math.sin(v * 2),
            (R + r * Math.cos(v * 2)) * Math.sin(u)
          );
        }
        return n.clone().multiplyScalar(1.5);
      });
    }

    const targets = [buildTarget('device'), buildTarget('signal'), buildTarget('sync'), buildTarget('sphere')];
    const formNames = ['DEVICE', 'SIGNAL', 'SYNC', 'COVERAGE'];

    const morphGeo = baseGeo.clone();

    const material = new THREE.MeshStandardMaterial({
      color: 0xedefe9, metalness: 0.3, roughness: 0.4, flatShading: true,
    });
    const wireMaterial = new THREE.MeshBasicMaterial({
      color: 0xff6b35, wireframe: true, transparent: true, opacity: 0.25,
    });

    const mesh = new THREE.Mesh(morphGeo, material);
    const wireMesh = new THREE.Mesh(morphGeo, wireMaterial);
    wireMesh.scale.setScalar(1.03);
    scene.add(mesh);
    scene.add(wireMesh);

    function isMobile() {
      return window.innerWidth < 840;
    }
    function positionRig() {
      const x = isMobile() ? 0 : 2.0;
      mesh.position.x = x;
      wireMesh.position.x = x;
      const scale = isMobile() ? 0.55 : 1;
      mesh.scale.setScalar(scale);
      wireMesh.scale.setScalar(scale * 1.03);
    }
    positionRig();

    const tmpA = new THREE.Vector3();
    const tmpB = new THREE.Vector3();
    function applyMorph(progress: number) {
      const clamped = Math.max(0, Math.min(targets.length - 1, progress));
      const floor = Math.floor(clamped);
      const ceil = Math.min(floor + 1, targets.length - 1);
      let frac = clamped - floor;
      frac = frac * frac * (3 - 2 * frac);
      const from = targets[floor], to = targets[ceil];
      const posArr = morphGeo.attributes.position;
      for (let i = 0; i < vertCount; i++) {
        tmpA.copy(from[i]);
        tmpB.copy(to[i]);
        tmpA.lerp(tmpB, frac);
        posArr.setXYZ(i, tmpA.x, tmpA.y, tmpA.z);
      }
      posArr.needsUpdate = true;
      morphGeo.computeVertexNormals();
    }

    const rxEl = document.getElementById('rx');
    const ryEl = document.getElementById('ry');
    const formEl = document.getElementById('rform');

    let targetRotY = 0;
    let targetMorph = 0;
    let displayMorph = 0;
    let lastLabelIndex = -1;
    let rafId: number;

    function onScroll() {
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      const progress = Math.min(Math.max(window.scrollY / docHeight, 0), 1);
      targetMorph = progress * (targets.length - 1);
      targetRotY = progress * Math.PI * 6;
    }
    window.addEventListener('scroll', onScroll, { passive: true });

    let mouseY = 0;
    function onMouseMove(e: MouseEvent) {
      mouseY = e.clientY / window.innerHeight - 0.5;
    }
    window.addEventListener('mousemove', onMouseMove);

    function animate() {
      rafId = requestAnimationFrame(animate);
      mesh.rotation.y += (targetRotY - mesh.rotation.y) * 0.06;
      mesh.rotation.x += (mouseY * 0.6 - mesh.rotation.x) * 0.04;
      wireMesh.rotation.y = mesh.rotation.y;
      wireMesh.rotation.x = mesh.rotation.x;
      mesh.rotation.z += 0.0015;
      wireMesh.rotation.z = mesh.rotation.z;

      displayMorph += (targetMorph - displayMorph) * 0.07;
      applyMorph(displayMorph);

      const labelIndex = Math.round(displayMorph);
      if (labelIndex !== lastLabelIndex) {
        lastLabelIndex = labelIndex;
        if (formEl) formEl.textContent = formNames[labelIndex];
      }

      if (rxEl) rxEl.textContent = Math.round((mesh.rotation.x * 180) / Math.PI % 360) + '°';
      if (ryEl) ryEl.textContent = Math.round((mesh.rotation.y * 180) / Math.PI % 360) + '°';

      renderer.render(scene, camera);
    }
    applyMorph(0);
    animate();
    onScroll();

    function onResize() {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
      positionRig();
    }
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('resize', onResize);
    };
  }, [threeLoaded]);

  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link
        href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap"
        rel="stylesheet"
      />
      <Script
        src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"
        strategy="afterInteractive"
        onLoad={() => setThreeLoaded(true)}
      />

      <style>{`
        :root{
          --bg:#0D1210; --surface:#131A17; --surface-2:#182019;
          --bone:#EDEFE9; --bone-dim:#9FAAA3;
          --signal:#FF6B35; --signal-soft:#a34a26; --steel:#3E7CB1;
          --line:rgba(237,239,233,0.1);
          --gradient-signal: linear-gradient(135deg, #FF6B35 0%, #ff9a66 45%, #3E7CB1 100%);
          --gradient-glow: radial-gradient(circle at 18% 15%, rgba(255,107,53,0.16), transparent 55%),
                           radial-gradient(circle at 85% 75%, rgba(62,124,177,0.16), transparent 50%);
        }
        *{margin:0;padding:0;box-sizing:border-box;}
        html,body{max-width:100%;}
        html{scroll-behavior:smooth;}
        body{background:var(--bg);color:var(--bone);font-family:'Inter',sans-serif;overflow-x:hidden;}
        @media (prefers-reduced-motion: reduce){ html{scroll-behavior:auto;} }
        ::selection{background:var(--signal);color:var(--bg);}
        .mono{font-family:'IBM Plex Mono',monospace;letter-spacing:0.03em;}
        .display{font-family:'Space Grotesk',sans-serif;}
        .grad-text{background:var(--gradient-signal);-webkit-background-clip:text;background-clip:text;color:transparent;}

        .bg-glow{position:fixed;inset:0;z-index:0;background:var(--gradient-glow);pointer-events:none;}

        nav{position:fixed;top:0;left:0;right:0;z-index:100;display:flex;justify-content:space-between;align-items:center;padding:26px 5vw;mix-blend-mode:difference;gap:12px;}
        .nav-mark{font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:1rem;letter-spacing:0.02em;white-space:nowrap;}
        .nav-links{display:flex;gap:32px;font-size:0.76rem;}
        .nav-links a{color:var(--bone-dim);text-decoration:none;text-transform:uppercase;letter-spacing:0.08em;transition:color .3s;white-space:nowrap;}
        .nav-links a:hover{color:var(--bone);}
        @media (max-width:640px){.nav-links{gap:14px;font-size:0.62rem;}}
        @media (max-width:480px){ nav{padding:16px 6vw;flex-wrap:wrap;row-gap:10px;} .nav-links{width:100%;justify-content:space-between;gap:0;font-size:0.6rem;} .nav-mark{font-size:0.85rem;} }
        @media (max-width:360px){ .nav-links{font-size:0.52rem;} }

        #scene-canvas{position:fixed;top:0;left:0;width:100%;height:100%;z-index:1;pointer-events:none;}

        .readout{position:fixed;bottom:28px;right:5vw;z-index:5;font-size:0.7rem;color:var(--bone-dim);text-align:right;line-height:1.6;pointer-events:none;opacity:0.85;}
        .readout span{color:var(--signal);}
        @media (max-width:640px){ .readout{display:none;} }

        section{position:relative;z-index:2;min-height:100vh;display:flex;flex-direction:column;justify-content:center;padding:0 5vw;}
        @media (max-width:640px){ section{padding:0 6vw;} }

        .hero{align-items:flex-start;padding-top:120px;padding-bottom:60px;}
        @media (max-width:640px){ .hero{padding-top:104px;} }
        @media (max-width:420px){ .hero{padding-top:92px;} }
        .eyebrow{font-size:0.74rem;text-transform:uppercase;color:var(--signal);margin-bottom:20px;display:flex;align-items:center;gap:10px;}
        .eyebrow::before{content:'';width:26px;height:1px;background:var(--signal);display:inline-block;}
        .status-dot{width:6px;height:6px;border-radius:50%;background:var(--signal);display:inline-block;box-shadow:0 0 0 3px rgba(255,107,53,0.2);}

        h1.headline{font-weight:600;font-size:clamp(2.1rem,6.4vw,4.6rem);line-height:1.1;max-width:15ch;}
        .hero-sub{margin-top:26px;max-width:52ch;font-size:clamp(0.92rem,2.4vw,1.02rem);color:var(--bone-dim);line-height:1.65;}
        .hero-links{margin-top:34px;display:flex;gap:22px;flex-wrap:wrap;font-size:0.85rem;}
        .hero-links a{color:var(--bone);text-decoration:none;border-bottom:1px solid var(--signal-soft);padding-bottom:3px;}
        .hero-links a:hover{border-color:var(--signal);}

        .hero-stats{margin-top:56px;display:flex;gap:46px;flex-wrap:wrap;row-gap:28px;}
        .hero-stats div strong{font-family:'Space Grotesk',sans-serif;font-size:2rem;display:block;font-weight:700;}
        .hero-stats div span{font-size:0.72rem;color:var(--bone-dim);text-transform:uppercase;}
        @media (max-width:640px){ .hero-stats{gap:30px;margin-top:42px;} .hero-stats div strong{font-size:1.6rem;} }
        @media (max-width:420px){ .hero-stats{gap:22px;} }

        .scroll-cue{position:absolute;bottom:36px;left:5vw;font-size:0.66rem;color:var(--bone-dim);display:flex;align-items:center;gap:10px;}
        .scroll-cue .bar{width:1px;height:32px;background:linear-gradient(var(--signal),transparent);animation:scrollpulse 2s ease-in-out infinite;}
        @keyframes scrollpulse{0%,100%{opacity:0.3;}50%{opacity:1;}}
        @media (max-width:640px){ .scroll-cue{display:none;} }

        .products{border-top:1px solid var(--line);align-items:flex-start;padding-top:100px;padding-bottom:100px;}
        .product-grid{display:grid;grid-template-columns:1fr 1fr;gap:26px;max-width:1120px;width:100%;}
        @media (max-width:900px){ .product-grid{grid-template-columns:1fr;} }
        .product-card{position:relative;border:1px solid var(--line);border-radius:20px;padding:34px;background:linear-gradient(165deg, var(--surface) 0%, var(--surface-2) 100%);overflow:hidden;}
        .product-card::before{content:'';position:absolute;top:-45%;right:-25%;width:75%;height:75%;background:var(--gradient-signal);opacity:0.14;filter:blur(60px);border-radius:50%;pointer-events:none;}
        .product-top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:16px;position:relative;z-index:1;flex-wrap:wrap;}
        .product-card h3{font-family:'Space Grotesk',sans-serif;font-size:1.5rem;font-weight:700;position:relative;z-index:1;}
        .live-badge{display:inline-flex;align-items:center;gap:6px;font-size:0.62rem;text-transform:uppercase;letter-spacing:0.08em;color:#8fffa0;background:rgba(80,220,120,0.12);border:1px solid rgba(80,220,120,0.35);padding:5px 12px;border-radius:100px;white-space:nowrap;}
        .live-badge .dot{width:6px;height:6px;border-radius:50%;background:#3ddc63;box-shadow:0 0 0 3px rgba(61,220,99,0.25);animation:pulse-live 1.8s ease-in-out infinite;}
        .build-badge{display:inline-flex;align-items:center;gap:6px;font-size:0.62rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--bone-dim);background:rgba(237,239,233,0.06);border:1px solid var(--line);padding:5px 12px;border-radius:100px;white-space:nowrap;}
        @keyframes pulse-live{0%,100%{opacity:1;}50%{opacity:0.35;}}
        .product-card p{color:var(--bone-dim);font-size:0.92rem;line-height:1.7;margin-bottom:22px;position:relative;z-index:1;max-width:50ch;}
        .product-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:26px;position:relative;z-index:1;}
        .product-stats div strong{display:block;font-family:'Space Grotesk',sans-serif;font-size:1.35rem;font-weight:700;}
        .product-stats div span{font-size:0.6rem;color:var(--bone-dim);text-transform:uppercase;letter-spacing:0.02em;}
        @media (max-width:480px){ .product-stats{grid-template-columns:repeat(2,1fr);} }
        .product-cta-row{display:flex;gap:14px;flex-wrap:wrap;position:relative;z-index:1;}
        .product-cta{display:inline-flex;align-items:center;gap:8px;padding:12px 22px;border-radius:100px;background:var(--gradient-signal);color:#0D1210;font-weight:600;font-size:0.8rem;text-decoration:none;transition:transform .25s, box-shadow .25s;}
        .product-cta:hover{transform:translateY(-2px);box-shadow:0 10px 28px rgba(255,107,53,0.3);}
        .product-cta.ghost{background:transparent;border:1px solid var(--line);color:var(--bone);}
        .product-cta.ghost:hover{border-color:var(--signal);box-shadow:none;transform:none;}

        .work{border-top:1px solid var(--line);align-items:flex-start;padding-top:100px;padding-bottom:100px;}
        .section-label{font-size:0.72rem;color:var(--signal);text-transform:uppercase;margin-bottom:40px;}
        .timeline{width:100%;max-width:900px;display:flex;flex-direction:column;gap:0;}
        .job{display:grid;grid-template-columns:140px 1fr;gap:32px;padding:32px 0;border-top:1px solid var(--line);}
        .job:first-child{border-top:1px solid var(--line);}
        .job-date{font-size:0.75rem;color:var(--bone-dim);}
        .job-date .active{color:var(--signal);display:block;margin-top:6px;font-size:0.68rem;text-transform:uppercase;}
        .job h3{font-family:'Space Grotesk',sans-serif;font-size:1.4rem;font-weight:600;}
        .job .role{color:var(--steel);font-size:0.85rem;margin-top:4px;margin-bottom:14px;}
        .job p{color:var(--bone-dim);line-height:1.7;font-size:0.95rem;max-width:60ch;margin-bottom:10px;}
        .job-stack{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;}
        .job-stack span{font-size:0.66rem;padding:5px 11px;border:1px solid var(--line);border-radius:100px;color:var(--bone-dim);}
        @media (max-width:700px){ .job{grid-template-columns:1fr;gap:10px;} }
        @media (max-width:640px){ .work,.products,.skills,.projects,.education,.contact{padding-top:70px;padding-bottom:70px;} }

        .skills{border-top:1px solid var(--line);}
        .skills-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:36px;max-width:1100px;}
        @media (max-width:1000px){ .skills-grid{grid-template-columns:1fr 1fr;} }
        @media (max-width:560px){ .skills-grid{grid-template-columns:1fr;gap:26px;} }
        .skill-col h4{font-family:'Space Grotesk',sans-serif;font-size:0.95rem;margin-bottom:14px;color:var(--signal);}
        .skill-col p{color:var(--bone-dim);font-size:0.88rem;line-height:1.75;}

        .projects{border-top:1px solid var(--line);}
        .projects-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:28px;max-width:1100px;}
        @media (max-width:1000px){ .projects-grid{grid-template-columns:1fr 1fr;} }
        @media (max-width:640px){ .projects-grid{grid-template-columns:1fr;} }
        .project-card{border:1px solid var(--line);border-radius:14px;padding:26px;background:var(--surface);}
        .project-card h4{font-family:'Space Grotesk',sans-serif;font-size:1.05rem;margin-bottom:10px;}
        .project-card p{color:var(--bone-dim);font-size:0.87rem;line-height:1.7;margin-bottom:14px;}
        .project-card .job-stack{margin-top:0;}

        .education{border-top:1px solid var(--line);}
        .edu-row{display:flex;justify-content:space-between;align-items:baseline;max-width:900px;flex-wrap:wrap;gap:10px;padding:18px 0;border-top:1px solid var(--line);}
        .edu-row:first-of-type{border-top:none;}
        .edu-row h4{font-family:'Space Grotesk',sans-serif;font-size:1.1rem;font-weight:600;}
        .edu-row span{color:var(--bone-dim);font-size:0.85rem;}
        .edu-row .mono{font-size:0.72rem;color:var(--steel);}
        .langs{margin-top:26px;font-size:0.85rem;color:var(--bone-dim);}
        .langs span{color:var(--bone);}

        .contact{border-top:1px solid var(--line);align-items:flex-start;}
        .contact h2{font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:clamp(2rem,6vw,4.4rem);line-height:1.08;max-width:16ch;}
        .contact-link{margin-top:32px;font-size:1.05rem;color:var(--signal);text-decoration:none;border-bottom:1px solid var(--signal-soft);padding-bottom:4px;word-break:break-word;}
        .contact-link:hover{opacity:0.8;}
        .contact-row{margin-top:14px;display:flex;gap:26px;flex-wrap:wrap;font-size:0.88rem;color:var(--bone-dim);}
        .contact-row a{color:var(--bone-dim);text-decoration:none;}
        .contact-row a:hover{color:var(--bone);}

        footer{padding:26px 5vw 38px;display:flex;justify-content:space-between;font-size:0.68rem;color:var(--bone-dim);border-top:1px solid var(--line);position:relative;z-index:2;flex-wrap:wrap;gap:10px;}
      `}</style>

      <div className="bg-glow" />
      <canvas id="scene-canvas" />

      <div className="readout mono" id="readout">
        X: <span id="rx">0°</span> &nbsp; Y: <span id="ry">0°</span>
        <br />
        STATE: <span id="rform">DEVICE</span>
      </div>

      <nav>
        <div className="nav-mark">AHMAD ALTAF</div>
        <div className="nav-links">
          <a href="#products">Products</a>
          <a href="#work">Work</a>
          <a href="#skills">Stack</a>
          <a href="#projects">Projects</a>
          <a href="#contact">Contact</a>
        </div>
      </nav>

      <section className="hero">
        <div className="eyebrow mono">
          <span className="status-dot" />
          Open to full stack roles — Multan, Pakistan
        </div>
        <h1 className="headline display">
          I build and run the ERP a 300-person field team clocks into every morning.
        </h1>
        <p className="hero-sub">
          Next.js, TypeScript and PostgreSQL on the web. Kotlin and Jetpack Compose on Android. I write the
          schema, the API routes, and the screens that call them — then take the same logic onto a cheap phone
          that has to work with no signal and never lose a day&apos;s work.
        </p>
        <div className="hero-links">
          <a href="mailto:ahmad.altaf7500@gmail.com">ahmad.altaf7500@gmail.com</a>
          <a href="tel:+923136704289">+92 313 6704289</a>
          <a href="/Ahmad-Altaf-CV.pdf">Download CV →</a>
        </div>
        <div className="hero-stats">
          <div>
            <strong className="grad-text">300+</strong>
            <span>User accounts on the system</span>
          </div>
          <div>
            <strong className="grad-text">60+</strong>
            <span>REST API routes built</span>
          </div>
          <div>
            <strong className="grad-text">13</strong>
            <span>Admin dashboard modules</span>
          </div>
          <div>
            <strong className="grad-text">10</strong>
            <span>Roles, role-based access</span>
          </div>
        </div>
        <div className="scroll-cue mono">
          <div className="bar" />
          SCROLL
        </div>
      </section>

      <section className="products" id="products">
        <div className="section-label mono">Products live in the world</div>
        <div className="product-grid">
          <div className="product-card">
            <div className="product-top">
              <h3 className="display">GMPL <span className="grad-text">360</span></h3>
              <span className="live-badge">
                <span className="dot" />
                Live on Google Play
              </span>
            </div>
            <p>
              The in-house ERP that runs field-sales operations for a nationwide FMCG distribution team —
              a Next.js + PostgreSQL web platform with a native Kotlin/Jetpack Compose Android companion,
              now shipped and installed on real phones in the field.
            </p>
            <div className="product-stats">
              <div><strong className="grad-text">300+</strong><span>Staff using it daily</span></div>
              <div><strong className="grad-text">38</strong><span>Cities covered</span></div>
              <div><strong className="grad-text">308</strong><span>Stores tracked</span></div>
            </div>
            <div className="product-cta-row">
              <a className="product-cta" href="https://play.google.com/store/apps/details?id=com.gmpl360.myapp" target="_blank" rel="noopener noreferrer">
                View on Google Play →
              </a>
            </div>
          </div>

          <div className="product-card">
            <div className="product-top">
              <h3 className="display"><span className="grad-text">Pharvizo</span></h3>
              <span className="build-badge">In active development</span>
            </div>
            <p>
              An offline-first Pharmacy Management &amp; POS system built as a resalable product for medical
              stores in Pakistan — Tauri + Rust backend, React/TypeScript frontend, SQLite locally with
              peer-to-peer LAN sync between store counters and no single point of failure.
            </p>
            <div className="product-stats">
              <div><strong className="grad-text">12+</strong><span>MVP modules built</span></div>
              <div><strong className="grad-text">28</strong><span>Module system scoped</span></div>
              <div><strong className="grad-text">0</strong><span>Internet required</span></div>
            </div>
            <div className="product-cta-row">
              <span className="product-cta ghost">POS · Inventory · Khata · Licensing</span>
            </div>
          </div>
        </div>
      </section>

      <section className="work" id="work">
        <div className="section-label mono">Work</div>
        <div className="timeline">
          <div className="job">
            <div className="job-date mono">
              Jun 2026 → now<span className="active">● Active</span>
            </div>
            <div>
              <h3 className="display">Global Marks</h3>
              <div className="role">Full Stack Developer</div>
              <p>
                Sole developer of GMPL 360, an in-house ERP for field-sales operations — a Next.js (App Router)
                and TypeScript web platform on PostgreSQL, with a companion native Android app, supporting 300+
                user accounts across ten organisational roles.
              </p>
              <p>
                Built 60+ REST API routes and a 13-module admin dashboard covering attendance, sales entry and
                multi-stage approval, inventory, store assignments, monthly targets, leave and resignation
                workflows, and salary calculation, with Excel and PDF export.
              </p>
              <p>
                Wrote the reporting layer in PostgreSQL — multi-level manager hierarchies, per-store and
                per-SKU sales aggregation, and attendance summaries across 300+ employee records — and
                implemented role-based access with JWT issued in httpOnly cookies, Next.js middleware routing
                each role to its own dashboard.
              </p>
              <p>
                On Android: GPS-verified shift check-in and check-out, camera capture with on-device image
                compression, an offline queue that retries automatically, and all-day location tracking via a
                foreground service and WorkManager. Ported the salary engine from TypeScript to Kotlin and
                validated it field by field against the web result. Took the app through Google Play release —
                data safety declarations, privacy policy, account-deletion flow, signed App Bundle — and it is
                now live on Google Play.
              </p>
              <div className="job-stack">
                <span>Next.js 16</span>
                <span>TypeScript</span>
                <span>PostgreSQL</span>
                <span>REST APIs</span>
                <span>JWT / RBAC</span>
                <span>Kotlin</span>
                <span>Jetpack Compose</span>
              </div>
            </div>
          </div>
          <div className="job">
            <div className="job-date mono">
              2026 → now<span className="active">● Active</span>
            </div>
            <div>
              <h3 className="display">Freelance</h3>
              <div className="role">Web Developer &amp; Integration Specialist</div>
              <p>
                Responsive sites and landing pages in Next.js and React, built from Figma, wired to CRMs and
                other platforms through REST APIs and webhooks. I handle the whole thing — what the client
                wants, what gets built, what gets delivered.
              </p>
              <div className="job-stack">
                <span>Next.js</span>
                <span>React</span>
                <span>Tailwind CSS</span>
                <span>REST APIs</span>
                <span>Webhooks</span>
              </div>
            </div>
          </div>
          <div className="job">
            <div className="job-date mono">2025 → 2026</div>
            <div>
              <h3 className="display">Tech Harborage</h3>
              <div className="role">GoHighLevel Specialist</div>
              <p>
                Built customised funnels and landing pages for client products from Figma designs, connected
                platforms through Zapier and Pabbly integrations, and turned the repeated parts into reusable
                snapshots and templates.
              </p>
              <div className="job-stack">
                <span>GoHighLevel</span>
                <span>Figma</span>
                <span>Zapier</span>
                <span>Pabbly</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="skills" id="skills">
        <div className="section-label mono">Technical skills</div>
        <div className="skills-grid">
          <div className="skill-col">
            <h4>Web</h4>
            <p>Next.js (App Router), React, Node.js, TypeScript, JavaScript, Tailwind CSS, REST API design, middleware routing, HTML5, CSS3.</p>
          </div>
          <div className="skill-col">
            <h4>Backend &amp; Database</h4>
            <p>PostgreSQL — schema design, joins and views, aggregate reporting queries, query debugging. REST API design end to end.</p>
          </div>
          <div className="skill-col">
            <h4>Mobile</h4>
            <p>Android, Kotlin, Jetpack Compose, Material 3, Retrofit, OkHttp, WorkManager, Foreground Services, Google Play Console.</p>
          </div>
          <div className="skill-col">
            <h4>Auth &amp; Security</h4>
            <p>JWT, httpOnly cookies, role-based access control across ten organisational roles, encrypted on-device storage.</p>
          </div>
        </div>
        <div className="skills-grid" style={{ marginTop: 36 }}>
          <div className="skill-col">
            <h4>Tools &amp; Integration</h4>
            <p>Git, GitHub, Android Studio, VS Code, pgAdmin, Vercel, Figma, Webhooks, Zapier, Pabbly, GoHighLevel.</p>
          </div>
          <div className="skill-col">
            <h4>Learning next</h4>
            <p>TanStack Query, Zustand, component testing with Vitest.</p>
          </div>
        </div>
      </section>

      <section className="projects" id="projects">
        <div className="section-label mono">Selected projects</div>
        <div className="projects-grid">
          <div className="project-card">
            <h4 className="display">Lead-Capture Landing Page &amp; Automation</h4>
            <p>Built a high-converting page from a Figma design and wired form submissions to a CRM via webhooks, automating lead routing and follow-up email.</p>
            <div className="job-stack">
              <span>Next.js</span>
              <span>REST APIs</span>
              <span>Zapier</span>
              <span>Pabbly</span>
            </div>
          </div>
          <div className="project-card">
            <h4 className="display">Task Manager Web App</h4>
            <p>Full CRUD task manager built on Next.js API routes, with a component-driven UI, filtering and persistent state — frontend and backend in the same codebase.</p>
            <div className="job-stack">
              <span>Next.js</span>
              <span>API Routes</span>
              <span>Tailwind CSS</span>
            </div>
          </div>
          <div className="project-card">
            <h4 className="display">Personal Portfolio Website</h4>
            <p>Responsive, mobile-first portfolio built from reusable React components; deployed to Vercel with optimised images and a working contact form.</p>
            <div className="job-stack">
              <span>Next.js</span>
              <span>React</span>
              <span>Tailwind CSS</span>
              <span>Vercel</span>
            </div>
          </div>
        </div>
      </section>

      <section className="education" id="education">
        <div className="section-label mono">Education</div>
        <div className="edu-row">
          <div>
            <h4 className="display">BS Computer Science</h4>
            <span>NCBA&amp;E, Multan, Pakistan</span>
          </div>
          <span className="mono">2020 – 2024</span>
        </div>
        <div className="langs">
          Languages — <span>English (Fluent)</span> · <span>Urdu (Native)</span>
        </div>
      </section>

      <section className="contact" id="contact">
        <div className="section-label mono">Get in touch</div>
        <h2 className="display">Looking for a full stack team to grow with.</h2>
        <a className="contact-link mono" href="mailto:ahmad.altaf7500@gmail.com">
          ahmad.altaf7500@gmail.com →
        </a>
        <div className="contact-row">
          <a href="tel:+923136704289">+92 313 6704289</a>
          <a href="/Ahmad-Altaf-CV.pdf">Download CV</a>
        </div>
      </section>

      <footer>
        <span className="mono">Built with Next.js &amp; Tailwind CSS</span>
        <span className="mono">No analytics, no cookies</span>
      </footer>
    </>
  );
}

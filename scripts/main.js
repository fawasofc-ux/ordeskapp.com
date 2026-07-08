// ===== Ordesk Landing Page - JavaScript =====

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initNavScroll();
  initMobileMenu();
  initScrollAnimations();
  initSmoothScroll();
  initScrollProgress();
  initAmbientBackground();
});

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// --- Theme Toggle ---
function initTheme() {
  const toggle = document.querySelector('.theme-toggle');
  const savedTheme = localStorage.getItem('ordesk-theme');

  // Apply saved theme or detect system preference
  if (savedTheme) {
    document.documentElement.setAttribute('data-theme', savedTheme);
  } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }

  toggle?.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('ordesk-theme', next);
  });

  // Listen for system theme changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (!localStorage.getItem('ordesk-theme')) {
      document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
    }
  });
}

// --- Navbar Scroll Effect ---
function initNavScroll() {
  const nav = document.querySelector('.nav');

  function checkScroll() {
    if (window.scrollY > 20) {
      nav?.classList.add('scrolled');
    } else {
      nav?.classList.remove('scrolled');
    }
  }

  window.addEventListener('scroll', checkScroll, { passive: true });
  checkScroll();
}

// --- Mobile Menu ---
function initMobileMenu() {
  const btn = document.querySelector('.mobile-menu-btn');
  const links = document.querySelector('.nav-links');

  btn?.addEventListener('click', () => {
    links?.classList.toggle('active');
    const isOpen = links?.classList.contains('active');
    btn.setAttribute('aria-expanded', isOpen);
  });

  // Close menu when clicking a link
  links?.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      links.classList.remove('active');
      btn?.setAttribute('aria-expanded', 'false');
    });
  });
}

// --- Scroll Animations (Intersection Observer) ---
function initScrollAnimations() {
  const elements = document.querySelectorAll('.fade-in');

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    }, {
      threshold: 0.1,
      rootMargin: '0px 0px -40px 0px'
    });

    elements.forEach(el => observer.observe(el));
  } else {
    // Fallback: show all elements
    elements.forEach(el => el.classList.add('visible'));
  }
}

// --- Scroll Progress Bar ---
function initScrollProgress() {
  const bar = document.querySelector('.scroll-progress');
  if (!bar) return;

  let ticking = false;
  function update() {
    const doc = document.documentElement;
    const max = doc.scrollHeight - doc.clientHeight;
    const progress = max > 0 ? Math.min(window.scrollY / max, 1) : 0;
    bar.style.transform = `scaleX(${progress})`;
    ticking = false;
  }

  window.addEventListener('scroll', () => {
    if (!ticking) {
      window.requestAnimationFrame(update);
      ticking = true;
    }
  }, { passive: true });
  window.addEventListener('resize', update, { passive: true });
  update();
}

// --- Ambient Animated Background ---
// A theme-adaptive "connected workspace" field: drifting nodes linked by
// faint lines, layered over slow-moving gradient orbs. Reacts subtly to
// scroll (parallax) and pointer movement, and pauses when off-screen.
function initAmbientBackground() {
  const canvas = document.querySelector('.bg-canvas');
  if (!canvas || prefersReducedMotion) return;

  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return;

  let width = 0, height = 0, dpr = 1;
  let nodes = [];
  let orbs = [];
  let raf = null;
  let running = true;

  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  let scrollY = window.scrollY;

  // Theme-aware colour palette.
  function palette() {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    return dark
      ? { rgb: '96, 165, 250', nodeA: 0.55, lineA: 0.16, orbs: ['rgba(37,99,235,0.20)', 'rgba(59,130,246,0.14)', 'rgba(99,102,241,0.12)'] }
      : { rgb: '37, 99, 235', nodeA: 0.40, lineA: 0.10, orbs: ['rgba(37,99,235,0.10)', 'rgba(59,130,246,0.08)', 'rgba(14,165,233,0.06)'] };
  }
  let colors = palette();

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    build();
  }

  function build() {
    // Node count scales with viewport area, capped for performance.
    const target = Math.round((width * height) / 26000);
    const count = Math.max(14, Math.min(52, target));
    nodes = [];
    for (let i = 0; i < count; i++) {
      nodes.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.28,
        vy: (Math.random() - 0.5) * 0.28,
        r: Math.random() * 1.6 + 1.1,
        depth: Math.random() * 0.6 + 0.4 // for parallax strength
      });
    }

    orbs = [
      { x: width * 0.18, y: height * 0.28, r: Math.max(width, height) * 0.32, dx: 0.10, dy: 0.06, c: 0 },
      { x: width * 0.82, y: height * 0.55, r: Math.max(width, height) * 0.30, dx: -0.08, dy: 0.07, c: 1 },
      { x: width * 0.55, y: height * 0.88, r: Math.max(width, height) * 0.26, dx: 0.06, dy: -0.09, c: 2 }
    ];
  }

  const LINK_DIST = 150;

  function frame() {
    if (!running) return;
    ctx.clearRect(0, 0, width, height);

    // Smooth pointer easing.
    pointer.x += (pointer.tx - pointer.x) * 0.05;
    pointer.y += (pointer.ty - pointer.y) * 0.05;
    const parallaxY = scrollY * 0.04;

    // Soft drifting gradient orbs.
    for (const orb of orbs) {
      orb.x += orb.dx;
      orb.y += orb.dy;
      if (orb.x < -orb.r || orb.x > width + orb.r) orb.dx *= -1;
      if (orb.y < -orb.r || orb.y > height + orb.r) orb.dy *= -1;
      const oy = orb.y - parallaxY * 0.5;
      const grd = ctx.createRadialGradient(orb.x, oy, 0, orb.x, oy, orb.r);
      grd.addColorStop(0, colors.orbs[orb.c]);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grd;
      ctx.fillRect(orb.x - orb.r, oy - orb.r, orb.r * 2, orb.r * 2);
    }

    // Update + draw nodes with light parallax and pointer influence.
    const pts = [];
    for (const n of nodes) {
      n.x += n.vx;
      n.y += n.vy;
      if (n.x < -20) n.x = width + 20; else if (n.x > width + 20) n.x = -20;
      if (n.y < -20) n.y = height + 20; else if (n.y > height + 20) n.y = -20;

      const px = n.x + pointer.x * 18 * n.depth;
      const py = n.y + pointer.y * 18 * n.depth - parallaxY * n.depth;
      pts.push({ x: px, y: py, r: n.r });

      ctx.beginPath();
      ctx.arc(px, py, n.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${colors.rgb}, ${colors.nodeA})`;
      ctx.fill();
    }

    // Connect nearby nodes.
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const dx = pts[i].x - pts[j].x;
        const dy = pts[i].y - pts[j].y;
        const dist = Math.hypot(dx, dy);
        if (dist < LINK_DIST) {
          const a = (1 - dist / LINK_DIST) * colors.lineA;
          ctx.strokeStyle = `rgba(${colors.rgb}, ${a})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(pts[i].x, pts[i].y);
          ctx.lineTo(pts[j].x, pts[j].y);
          ctx.stroke();
        }
      }
    }

    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (raf == null) { running = true; raf = requestAnimationFrame(frame); }
  }
  function stop() {
    running = false;
    if (raf != null) { cancelAnimationFrame(raf); raf = null; }
  }

  // Inputs.
  window.addEventListener('scroll', () => { scrollY = window.scrollY; }, { passive: true });
  window.addEventListener('pointermove', (e) => {
    pointer.tx = (e.clientX / width - 0.5) * 2;
    pointer.ty = (e.clientY / height - 0.5) * 2;
  }, { passive: true });

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 150);
  }, { passive: true });

  // Recolour instantly when the theme changes.
  new MutationObserver(() => { colors = palette(); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  // Pause when the tab is hidden to save battery/CPU.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop(); else start();
  });

  resize();
  canvas.classList.add('ready');
  start();
}

// --- Smooth Scroll for Anchor Links ---
function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', (e) => {
      const targetId = anchor.getAttribute('href');
      if (targetId === '#') return;

      const target = document.querySelector(targetId);
      if (target) {
        e.preventDefault();
        const navHeight = document.querySelector('.nav')?.offsetHeight || 72;
        const targetPos = target.getBoundingClientRect().top + window.scrollY - navHeight;

        window.scrollTo({
          top: targetPos,
          behavior: 'smooth'
        });
      }
    });
  });
}

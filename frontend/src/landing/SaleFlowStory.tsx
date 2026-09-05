import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import { Link } from "react-router-dom";
import { copy } from "@/i18n/messages";
import styles from "./SaleFlowStory.module.css";

export type LandingStoryStepId = "sale" | "inventory" | "cash" | "reports";
export type LandingStoryTrigger = "scroll" | "control";

const t = copy.landing.immersiveStory;

export default function SaleFlowStory({
  primaryTarget,
  onCtaClick,
  onStepView,
}: {
  primaryTarget: string;
  onCtaClick: () => void;
  onStepView: (step: LandingStoryStepId, trigger: LandingStoryTrigger) => void;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hasTrackedView = useRef(false);
  const [isPaused, setIsPaused] = useState(true);
  const [isMuted, setIsMuted] = useState(true);
  const [hasStarted, setHasStarted] = useState(false);

  const playVideo = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.ended || (video.duration && video.currentTime >= video.duration - 0.1)) {
      video.currentTime = 0;
    }
    const playback = video.play();
    playback?.catch(() => {
      setIsPaused(true);
    });
  }, []);

  useEffect(() => {
    const frame = frameRef.current;
    const video = videoRef.current;
    if (!frame || !video) return;

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (!("IntersectionObserver" in window)) {
      onStepView("sale", "scroll");
      if (!reduceMotion) playVideo();
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        const visibleRatio = entry.intersectionRatio ?? (entry.isIntersecting ? 1 : 0);
        if (entry.isIntersecting && visibleRatio >= 0.35) {
          if (!hasTrackedView.current) {
            hasTrackedView.current = true;
            onStepView("sale", "scroll");
          }
          if (!reduceMotion) playVideo();
        } else {
          video.pause();
        }
      },
      { threshold: [0, 0.35, 0.75] },
    );

    observer.observe(frame);
    return () => observer.disconnect();
  }, [onStepView, playVideo]);

  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) playVideo();
    else video.pause();
  };

  const toggleSound = () => {
    const video = videoRef.current;
    if (!video) return;
    const nextMuted = !video.muted;
    video.muted = nextMuted;
    setIsMuted(nextMuted);
    if (!nextMuted && video.paused) playVideo();
  };

  return (
    <section id="producto" className={styles.section} aria-labelledby="sale-flow-title">
      <h2 id="sale-flow-title" className={styles.srOnly}>
        {t.videoTitle}
      </h2>

      <div
        ref={frameRef}
        className={styles.frame}
        data-lp-reveal-opt
        data-lp-reveal-variant="frame"
      >
        <picture className={styles.poster} hidden={hasStarted}>
          <source media="(max-width: 700px)" srcSet="/film/kova-demo-vertical.webp" />
          <img src="/film/kova-demo-horizontal.webp" alt="" />
        </picture>

        <video
          ref={videoRef}
          className={styles.video}
          muted
          playsInline
          preload="metadata"
          aria-label={t.videoLabel}
          onPlaying={() => {
            setHasStarted(true);
            setIsPaused(false);
          }}
          onPause={() => setIsPaused(true)}
          onEnded={() => setIsPaused(true)}
        >
          <source
            media="(max-width: 700px)"
            src="/film/kova-demo-vertical.mp4"
            type="video/mp4"
          />
          <source src="/film/kova-demo-horizontal.mp4" type="video/mp4" />
          <track
            kind="captions"
            src="/film/kova-demo-es.vtt"
            srcLang="es"
            label="Español"
            default
          />
        </video>

        <div className={styles.controls} role="group" aria-label={t.controlsLabel}>
          <button type="button" className={styles.control} onClick={togglePlayback}>
            {isPaused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
            <span>{isPaused ? t.playVideo : t.pauseVideo}</span>
          </button>
          <button type="button" className={styles.control} onClick={toggleSound}>
            {isMuted ? <Volume2 aria-hidden="true" /> : <VolumeX aria-hidden="true" />}
            <span>{isMuted ? t.enableSound : t.disableSound}</span>
          </button>
        </div>
      </div>

      <Link to={primaryTarget} className={styles.cta} onClick={onCtaClick}>
        {t.cta}
      </Link>
    </section>
  );
}

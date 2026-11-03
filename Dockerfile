ARG BUILDER_IMAGE="wandererltd/build-base:latest"
ARG RUNNER_IMAGE="wandererltd/runner-base:latest"

FROM ${BUILDER_IMAGE} as builder

# prepare build dir
WORKDIR /app

# set build ENV
ENV MIX_ENV="prod"

# Set ERL_FLAGS for ARM compatibility
ENV ERL_FLAGS="+JPperf true"

# install mix dependencies
COPY mix.exs mix.lock ./
RUN rm -Rf _build deps && mix deps.get --only $MIX_ENV
RUN mkdir config

# copy compile-time config files before we compile dependencies
# to ensure any relevant config change will trigger the dependencies
# to be re-compiled.
COPY config/config.exs config/${MIX_ENV}.exs config/
COPY priv priv
COPY lib lib
COPY assets assets

# Only this file from the desktop project is needed at build time: it is the
# source of the desktop version advertised by /desktop/update.json.
COPY desktop/src-tauri/tauri.conf.json ./desktop/src-tauri/tauri.conf.json

RUN mix assets.deploy
RUN mix compile

# Changes to config/runtime.exs don't require recompiling the code
COPY config/runtime.exs config/
COPY rel rel

RUN mix release

# start a new build stage so that the final image will only contain
# the compiled release and other runtime necessities
FROM ${RUNNER_IMAGE}

WORKDIR "/app"
COPY --chmod=755 ./rel/docker-entrypoint.sh /app/entrypoint.sh
# Mount point for the Windows client release archives served by
# /download/desktop (see docs/desktop-release-and-usage.md). Created here so a
# named volume inherits the right owner; the container serves it read-only.
RUN mkdir -p /app/downloads
RUN chown nobody /app /app/downloads

# set runner ENV
ENV MIX_ENV="prod"

# Only copy the final release from the build stage
COPY --from=builder --chown=nobody:root /app/_build/${MIX_ENV}/rel/wanderer_app ./

USER nobody

ENTRYPOINT ["/app/entrypoint.sh"]

CMD ["run"]

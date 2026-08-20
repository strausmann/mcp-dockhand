// Jenkinsfile — hardened-fork sync pipeline for <YOU>/mcp-dockhand
//
// What it does on each run:
//   1. Detects whether upstream (strausmann/mcp-dockhand) published a new
//      release tag that the `hardened` branch is not yet based on.
//   2. If yes: fast-forwards the `main` mirror, rebases `hardened` onto the
//      new tag (rerere-assisted; fails closed on real conflicts).
//   3. Runs quality/security gates: npm audit, gitleaks, trivy fs.
//   4. Builds and tests; builds + scans the Docker image if a Dockerfile exists.
//   5. Pushes main, hardened (--force-with-lease) and a hardened-<tag> tag
//      back to the fork.
//
// Prereqs (see fork-kit/README.md):
//   - Credential id `github-pat`: username + fine-grained PAT (Contents: RW on the fork)
//   - Docker-capable agent labelled `docker`
//   - scripts/sync-upstream.sh committed at repo root (this kit)

pipeline {
    agent { label 'docker' }

    triggers {
        // Poll for upstream releases every ~6h. Replace with a webhook
        // trigger if you have one feeding release notifications.
        cron('H H/6 * * *')
    }

    options {
        timestamps()
        disableConcurrentBuilds()          // never race two rebases/pushes
        timeout(time: 45, unit: 'MINUTES')
        buildDiscarder(logRotator(numToKeepStr: '50'))
    }

    environment {
        FORK_REPO       = 'github.com/YOUR_GH_USER/mcp-dockhand.git'   // <-- EDIT
        UPSTREAM_REPO   = 'https://github.com/strausmann/mcp-dockhand.git'
        HARDENED_BRANCH = 'hardened'
        MIRROR_BRANCH   = 'main'
        GIT_AUTHOR_NAME  = 'jenkins-fork-bot'
        GIT_AUTHOR_EMAIL = 'jenkins-fork-bot@users.noreply.github.com'
        GIT_COMMITTER_NAME  = "${GIT_AUTHOR_NAME}"
        GIT_COMMITTER_EMAIL = "${GIT_AUTHOR_EMAIL}"
    }

    stages {

        stage('Checkout fork') {
            steps {
                // Full clone with tags: the sync script needs real history
                // for merge-base / rebase, so no shallow clone.
                checkout([$class: 'GitSCM',
                    branches: [[name: "*/${env.HARDENED_BRANCH}"]],
                    userRemoteConfigs: [[
                        url: "https://${env.FORK_REPO}",
                        credentialsId: 'github-pat'
                    ]],
                    extensions: [
                        [$class: 'CloneOption', shallow: false, noTags: false],
                        [$class: 'LocalBranch', localBranch: env.HARDENED_BRANCH]
                    ]
                ])
                sh '''
                    git remote get-url upstream >/dev/null 2>&1 || git remote add upstream "$UPSTREAM_REPO"
                    git fetch origin "$MIRROR_BRANCH:$MIRROR_BRANCH" || true
                    git config rerere.enabled true
                    git config rerere.autoUpdate true
                    chmod +x scripts/sync-upstream.sh
                '''
            }
        }

        stage('Detect upstream release') {
            steps {
                script {
                    env.NEW_TAG = sh(
                        script: './scripts/sync-upstream.sh detect',
                        returnStdout: true
                    ).trim()
                    if (env.NEW_TAG) {
                        currentBuild.displayName = "#${env.BUILD_NUMBER} sync ${env.NEW_TAG}"
                        echo "New upstream release detected: ${env.NEW_TAG}"
                    } else {
                        currentBuild.displayName = "#${env.BUILD_NUMBER} up-to-date"
                        echo 'No new upstream release; nothing to do.'
                    }
                }
            }
        }

        stage('Sync mirror + rebase hardened') {
            when { expression { env.NEW_TAG?.trim() } }
            steps {
                // Exit 3 = conflict rerere could not replay: the script has
                // already aborted the rebase; the build fails for a human.
                sh './scripts/sync-upstream.sh sync "$NEW_TAG"'
            }
        }

        stage('Install, build, test') {
            when { expression { env.NEW_TAG?.trim() } }
            agent { docker { image 'node:22-bookworm'; reuseNode true } }
            steps {
                sh '''
                    npm ci
                    npm run build --if-present
                    npm test --if-present
                '''
            }
        }

        stage('Security: dependency audit') {
            when { expression { env.NEW_TAG?.trim() } }
            agent { docker { image 'node:22-bookworm'; reuseNode true } }
            steps {
                // Gate on high/critical dependency CVEs.
                sh 'npm audit --audit-level=high'
            }
        }

        stage('Security: secret scan (gitleaks)') {
            when { expression { env.NEW_TAG?.trim() } }
            agent {
                docker {
                    image 'zricethezav/gitleaks:latest'
                    reuseNode true
                    args '--entrypoint=""'
                }
            }
            steps {
                sh 'gitleaks detect --source . --no-banner --redact'
            }
        }

        stage('Security: filesystem scan (trivy)') {
            when { expression { env.NEW_TAG?.trim() } }
            agent {
                docker {
                    image 'aquasec/trivy:latest'
                    reuseNode true
                    args '--entrypoint="" -v trivy-cache:/root/.cache/trivy'
                }
            }
            steps {
                // Lockfile CVEs + secrets + IaC/Dockerfile misconfig.
                sh 'trivy fs --scanners vuln,secret,misconfig --exit-code 1 --severity HIGH,CRITICAL --skip-dirs node_modules .'
            }
        }

        stage('Docker image build + scan') {
            when {
                allOf {
                    expression { env.NEW_TAG?.trim() }
                    expression { fileExists('Dockerfile') }
                }
            }
            steps {
                sh '''
                    docker build -t "mcp-dockhand:hardened-$NEW_TAG" .
                    docker run --rm \
                      -v /var/run/docker.sock:/var/run/docker.sock \
                      -v trivy-cache:/root/.cache/trivy \
                      aquasec/trivy:latest image \
                      --exit-code 1 --severity HIGH,CRITICAL \
                      "mcp-dockhand:hardened-$NEW_TAG"
                '''
                // To publish the image, add a `docker login` + `docker push`
                // to your registry here (separate registry credential).
            }
        }

        stage('Push secured branch to fork') {
            when { expression { env.NEW_TAG?.trim() } }
            steps {
                withCredentials([usernamePassword(
                    credentialsId: 'github-pat',
                    usernameVariable: 'GIT_USER',
                    passwordVariable: 'GIT_TOKEN'
                )]) {
                    // Single-quoted heredoc on purpose: secrets expand in the
                    // shell, never in Groovy (avoids interpolation leakage).
                    sh '''
                        set -euo pipefail
                        PUSH_URL="https://${GIT_USER}:${GIT_TOKEN}@${FORK_REPO}"
                        git push "$PUSH_URL" "$MIRROR_BRANCH:$MIRROR_BRANCH"
                        git push --force-with-lease "$PUSH_URL" "$HARDENED_BRANCH:$HARDENED_BRANCH"
                        git tag -f "hardened-$NEW_TAG" "$HARDENED_BRANCH"
                        git push -f "$PUSH_URL" "refs/tags/hardened-$NEW_TAG"
                        git push "$PUSH_URL" --tags || true   # mirror upstream v* tags, best effort
                    '''
                }
            }
        }
    }

    post {
        failure {
            echo "Sync of ${env.NEW_TAG ?: '(no tag)'} FAILED — if the rebase " +
                 'stage exited 3, a conflict needs a one-time manual resolution ' +
                 '(git rerere will replay it on future runs). See fork-kit/README.md §5.'
            // Wire your notifier here, e.g.:
            // slackSend channel: '#ops', message: "mcp-dockhand fork sync failed: ${env.BUILD_URL}"
        }
        success {
            script {
                if (env.NEW_TAG?.trim()) {
                    echo "Secured build for ${env.NEW_TAG} pushed as hardened-${env.NEW_TAG}."
                }
            }
        }
    }
}

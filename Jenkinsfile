library(
  identifier: 'jenkins-shared-library@master',
  retriever: modernSCM(
    [
      $class: 'GitSCMSource',
      remote: 'https://github.com/dhanarab/jenkins-pipeline-library.git'
    ]
  )
)

bitbucketCredentials = "bitbucket-build-extend-https"
bitbucketCredentialsSsh = "bitbucket-build-extend-ssh"

bitbucketPayload = null
bitbucketCommitHref = null

imageName = 'ags-api-mcp-server'

pipeline {
  agent {
    label "extend-builder-ci"
  }
  stages {
    stage('Prepare') {
      steps {
        script {
          if (env.BITBUCKET_PAYLOAD) {
            bitbucketPayload = readJSON text: env.BITBUCKET_PAYLOAD
            if (bitbucketPayload.pullrequest) {
              bitbucketCommitHref = bitbucketPayload.pullrequest.source.commit.links.self.href
            }
          }
          if (bitbucketCommitHref) {
            bitbucket.setBuildStatus(bitbucketCredentials, bitbucketCommitHref, "INPROGRESS", env.JOB_NAME, "${env.JOB_NAME}-${env.BUILD_NUMBER}", "Jenkins", "${env.BUILD_URL}console")
          }
        }
      }
    }
    stage('Lint Commits') {
      when {
        expression {
          return env.BITBUCKET_PULL_REQUEST_LATEST_COMMIT_FROM_TARGET_BRANCH
        }
      }
      agent {
        docker {
          image 'commitlint/commitlint:19.3.1'
          args '--entrypoint='
          reuseNode true
        }
      }
      steps {
        sh "git config --add safe.directory '*'"
        sh "commitlint --color false --verbose --from ${env.BITBUCKET_PULL_REQUEST_LATEST_COMMIT_FROM_TARGET_BRANCH}"
      }
    }
    stage('Build') {
      steps {
        sh "docker buildx inspect ${imageName}-builder || docker buildx create --name ${imageName}-builder --use"
        sh "docker buildx build -t ${imageName}:test --platform linux/amd64,linux/arm64 ."
        sh "docker buildx build -t ${imageName}:test --load ."
      }
      post {
        always {
          sh "docker buildx rm --keep-state ${imageName}-builder"
        }
      }
    }
    stage('Push to ECR') {
      when {
        expression {
          return (env.x_event_key == "pullrequest:fulfilled" && env.BITBUCKET_PULL_REQUEST_TARGET_BRANCH == "master")
        }
      }
      steps {
        withCredentials([
            [
                $class: 'AmazonWebServicesCredentialsBinding',
                credentialsId: "AWS-Prod-Cluster",
                accessKeyVariable: 'AWS_ACCESS_KEY_ID',
                secretKeyVariable: 'AWS_SECRET_ACCESS_KEY'
            ]
        ]) {
          script {
            def commitHash = sh(returnStdout: true, script: 'git rev-parse HEAD').trim().take(10)
            def imageTag = "master-${commitHash}"
            def ecrRepo = "144436415367.dkr.ecr.us-west-2.amazonaws.com/ags-api-mcp-server"

            sh "docker run --rm -t -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY amazon/aws-cli ecr get-login-password --region 'us-west-2' | docker login --username AWS --password-stdin 144436415367.dkr.ecr.us-west-2.amazonaws.com"
            sh "docker tag ${imageName}:test ${ecrRepo}:${imageTag}"
            sh "docker tag ${imageName}:test ${ecrRepo}:latest"
            // We only run amd64 at the moment.
            sh "docker push --platform linux/amd64 ${ecrRepo}:${imageTag}"
            sh "docker push --platform linux/amd64 ${ecrRepo}:latest"
          }

        }
      }
    }
  }
  post {
    success {
      script {
        if (bitbucketCommitHref) {
          bitbucket.setBuildStatus(bitbucketCredentials, bitbucketCommitHref, "SUCCESSFUL", env.JOB_NAME, "${env.JOB_NAME}-${env.BUILD_NUMBER}", "Jenkins", "${env.BUILD_URL}console")
        }
      }
    }
    failure {
      script {
        if (bitbucketCommitHref) {
          bitbucket.setBuildStatus(bitbucketCredentials, bitbucketCommitHref, "FAILED", env.JOB_NAME, "${env.JOB_NAME}-${env.BUILD_NUMBER}", "Jenkins", "${env.BUILD_URL}console")
        }
      }
    }
  }
}
